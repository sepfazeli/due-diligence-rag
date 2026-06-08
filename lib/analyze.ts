import Anthropic from "@anthropic-ai/sdk";

import { retrieve, type RetrievedChunk } from "./retrieval";

// User-specified model is Claude Sonnet. Exact current Sonnet ID, no date suffix.
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 3000;

// Confidence guardrail: if the top rerank score is below this, we DON'T call the
// model — weak retrieval ⇒ "not enough information". Tunable via env.
// (Measured: legit questions top out at 0.18–0.73; off-topic ≈ 0.01.)
const MIN_RERANK_SCORE = Number(process.env.ANALYZE_MIN_SCORE ?? "0.05");

let _anthropic: Anthropic | null = null;
const anthropic = () => (_anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

// ── output types ─────────────────────────────────────────────────────────────
export interface RiskFlag {
  severity: "red" | "amber";
  title: string;
  detail: string;
}
export interface Citation {
  docTitle: string;
  page: number;
  snippet: string;
}
export interface AnalysisResult {
  answer: string;
  riskFlags: RiskFlag[];
  financialMetrics: Record<string, string>;
  citations: Citation[];
  confidence: "high" | "medium" | "low";
  meta: {
    model: string | null;
    topScore: number | null;
    guardrailTriggered: boolean;
    usedSources: { docTitle: string; page: number; section: string }[];
  };
}

// ── prompt + tool schema ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a due-diligence assistant for someone evaluating a small business for acquisition.
You are NOT a financial, legal, investment, or tax advisor, and you must not give advice or recommendations.
Your job is to surface and explain what the provided source documents say, with traceable citations.

Rules:
- Use ONLY the information in the provided SOURCES. Never use outside knowledge or assumptions.
- First extract the relevant figures and facts from the sources and state them explicitly, THEN reason about them.
- Every claim in your answer must be grounded in a source. Populate "citations" with the exact docTitle and page you used plus a short, verbatim snippet from that source.
- If the sources don't contain enough information to answer confidently, say so plainly in "answer", set "confidence" to "low", and don't invent details.
- riskFlags: only flag risks supported by the sources (e.g. customer concentration, declining margins, debt maturities, litigation, lease expiry). Use "red" for material/serious risks, "amber" for moderate ones.
- financialMetrics: extract concrete figures as label/value pairs, e.g. {label: "Revenue (FY2025)", value: "$1.52M"}. Values are strings exactly as supported by the sources.
- Never give recommendations ("you should buy/avoid/negotiate"). Describe, quantify, and flag — do not advise.`;

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "emit_analysis",
  description: "Return the structured due-diligence analysis grounded strictly in the provided sources.",
  // strict guarantees the tool input matches this schema (supported on Sonnet 4.6).
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: {
        type: "string",
        description: "Grounded, plain-language answer. State figures first, then reason. No advice.",
      },
      riskFlags: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            severity: { type: "string", enum: ["red", "amber"] },
            title: { type: "string" },
            detail: { type: "string" },
          },
          required: ["severity", "title", "detail"],
        },
      },
      financialMetrics: {
        type: "array",
        description: "Concrete figures as label/value pairs.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            value: { type: "string" },
          },
          required: ["label", "value"],
        },
      },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            docTitle: { type: "string" },
            page: { type: "integer" },
            snippet: { type: "string" },
          },
          required: ["docTitle", "page", "snippet"],
        },
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["answer", "riskFlags", "financialMetrics", "citations", "confidence"],
  },
};

interface ToolPayload {
  answer: string;
  riskFlags: RiskFlag[];
  financialMetrics: { label: string; value: string }[];
  citations: Citation[];
  confidence: "high" | "medium" | "low";
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[Source ${i + 1}] docTitle="${c.docTitle}" page=${c.page} section="${c.section}"\n${c.content}`,
    )
    .join("\n\n---\n\n");
}

/**
 * Retrieve → guardrail → Claude (strict tool use) → structured, cited analysis.
 */
export async function analyze(question: string, listingId: string): Promise<AnalysisResult> {
  const { chunks, topScore } = await retrieve(question, listingId);
  const usedSources = chunks.map((c) => ({ docTitle: c.docTitle, page: c.page, section: c.section }));

  // Guardrail: weak retrieval ⇒ don't spend a model call on weak context.
  if (chunks.length === 0 || topScore === null || topScore < MIN_RERANK_SCORE) {
    return {
      answer:
        "I don't have enough information in the uploaded documents for this listing to answer that confidently. Try rephrasing, or upload documents that cover this topic.",
      riskFlags: [],
      financialMetrics: {},
      citations: [],
      confidence: "low",
      meta: { model: null, topScore, guardrailTriggered: true, usedSources },
    };
  }

  const userMessage = `QUESTION:\n${question}\n\nSOURCES (use ONLY these):\n\n${buildContext(chunks)}`;

  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "emit_analysis" },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "emit_analysis",
  );
  if (!toolUse) {
    throw new Error("Model did not return the expected analysis tool output");
  }
  const out = toolUse.input as ToolPayload;

  // Transform the label/value array into the spec's financialMetrics map.
  const financialMetrics: Record<string, string> = {};
  for (const m of out.financialMetrics) financialMetrics[m.label] = m.value;

  return {
    answer: out.answer,
    riskFlags: out.riskFlags,
    financialMetrics,
    citations: out.citations,
    confidence: out.confidence,
    meta: { model: MODEL, topScore, guardrailTriggered: false, usedSources },
  };
}
