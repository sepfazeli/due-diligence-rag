// Shared, runtime-free types. Safe to import from client components (`import type`)
// without pulling server-only SDKs (Prisma, Anthropic, etc.) into the browser bundle.

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

export interface DocumentSummary {
  id: string;
  title: string;
  docType: string;
  chunkCount: number;
  uploadedAt: string;
}
