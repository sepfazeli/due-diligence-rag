"use client";

import { useState } from "react";

import type { AnalysisResult } from "@/lib/types";

const EXAMPLES = [
  "What are the main risks for this business?",
  "What were revenue, EBITDA, and net income over the last three years?",
  "Is there customer concentration risk?",
  "What liabilities or debts does the business have?",
];

const CONFIDENCE_STYLES: Record<AnalysisResult["confidence"], string> = {
  high: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function AnalyzePanel({ listingId }: { listingId: string }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, listingId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Request failed");
      setResult(data as AnalysisResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Question box */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(question);
          }}
        >
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Ask a question about this business
          </label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                run(question);
              }
            }}
            rows={3}
            placeholder="e.g. What are the main risks, and how have margins trended?"
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">⌘/Ctrl + Enter to submit</span>
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setQuestion(ex);
                run(ex);
              }}
              disabled={loading}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="animate-pulse space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="h-3 w-full rounded bg-slate-100" />
          <div className="h-3 w-5/6 rounded bg-slate-100" />
          <div className="h-3 w-2/3 rounded bg-slate-100" />
        </div>
      )}

      {result && !loading && <Results result={result} />}
    </div>
  );
}

function Results({ result }: { result: AnalysisResult }) {
  const metrics = Object.entries(result.financialMetrics);

  return (
    <div className="space-y-6">
      {/* Answer */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Answer</h2>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
              CONFIDENCE_STYLES[result.confidence]
            }`}
          >
            {result.confidence} confidence
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{result.answer}</p>
        {result.meta.guardrailTriggered && (
          <p className="mt-3 text-xs text-slate-400">
            Retrieval confidence was below threshold, so the model was not queried.
          </p>
        )}
      </section>

      {/* Risk flags */}
      {result.riskFlags.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Risk flags <span className="text-slate-400">({result.riskFlags.length})</span>
          </h2>
          <div className="space-y-2">
            {result.riskFlags.map((flag, i) => {
              const red = flag.severity === "red";
              return (
                <div
                  key={i}
                  className={`rounded-lg border-l-4 p-4 shadow-sm ${
                    red ? "border-rose-500 bg-rose-50" : "border-amber-400 bg-amber-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        red ? "bg-rose-500" : "bg-amber-400"
                      }`}
                    />
                    <h3
                      className={`text-sm font-semibold ${red ? "text-rose-900" : "text-amber-900"}`}
                    >
                      {flag.title}
                    </h3>
                    <span
                      className={`ml-auto text-[10px] font-semibold uppercase tracking-wide ${
                        red ? "text-rose-500" : "text-amber-500"
                      }`}
                    >
                      {flag.severity}
                    </span>
                  </div>
                  <p className={`mt-1 text-sm ${red ? "text-rose-800" : "text-amber-800"}`}>
                    {flag.detail}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Financial summary */}
      {metrics.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Financial summary</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {metrics.map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Citations */}
      {result.citations.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Citations <span className="text-slate-400">({result.citations.length})</span>
          </h2>
          <div className="space-y-2">
            {result.citations.map((c, i) => (
              <details
                key={i}
                className="group rounded-lg border border-slate-200 bg-white shadow-sm"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm">
                  <span className="font-medium text-slate-900">{c.docTitle}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                    page {c.page}
                  </span>
                  <span className="ml-auto text-xs text-slate-400 group-open:hidden">show</span>
                  <span className="ml-auto hidden text-xs text-slate-400 group-open:inline">hide</span>
                </summary>
                <div className="border-t border-slate-100 px-4 py-3">
                  <blockquote className="border-l-2 border-slate-200 pl-3 text-sm italic text-slate-600">
                    “{c.snippet}”
                  </blockquote>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Meta */}
      <p className="text-xs text-slate-400">
        {result.meta.model ? `Model: ${result.meta.model}` : "Model: not called"}
        {result.meta.topScore !== null && ` · top rerank score: ${result.meta.topScore.toFixed(3)}`}
        {result.meta.usedSources.length > 0 &&
          ` · ${result.meta.usedSources.length} chunks retrieved`}
      </p>
    </div>
  );
}
