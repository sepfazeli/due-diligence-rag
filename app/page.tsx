"use client";

import { useState } from "react";

import { AnalyzePanel } from "@/components/AnalyzePanel";
import { Disclaimer } from "@/components/Disclaimer";
import { DocumentsPanel } from "@/components/DocumentsPanel";

type Tab = "analyze" | "documents";

export default function Home() {
  const [listingId, setListingId] = useState("demo-listing-001");
  const [tab, setTab] = useState<Tab>("analyze");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              DD
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-900">
                Due Diligence RAG
              </h1>
              <p className="text-xs text-slate-500">
                Grounded answers, risk flags &amp; citations from a business&apos;s documents
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Listing</span>
            <input
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
              placeholder="listing id"
              className="w-52 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </label>
        </div>

        <div className="mx-auto -mb-px flex max-w-5xl gap-1 px-6">
          {(["analyze", "documents"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t === "analyze" ? "Analyze" : "Documents"}
            </button>
          ))}
        </div>
      </header>

      <Disclaimer />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {tab === "analyze" ? (
          <AnalyzePanel listingId={listingId} />
        ) : (
          <DocumentsPanel listingId={listingId} />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4">
        <div className="mx-auto max-w-5xl px-6 text-xs text-slate-400">
          Demo project · Answers are generated from retrieved document chunks · Not financial or legal
          advice.
        </div>
      </footer>
    </div>
  );
}
