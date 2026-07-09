"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DocumentSummary } from "@/lib/types";

const DOC_TYPE_STYLES: Record<string, string> = {
  FINANCIALS: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  DISCLOSURE: "bg-purple-50 text-purple-700 ring-purple-200",
  LISTING: "bg-teal-50 text-teal-700 ring-teal-200",
  OTHER: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function DocumentsPanel({ listingId }: { listingId: string }) {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    if (!listingId.trim()) return;
    setLoadingList(true);
    try {
      const res = await fetch(`/api/documents?listingId=${encodeURIComponent(listingId)}`);
      const data = await res.json();
      setDocs(res.ok ? data.documents : []);
    } catch {
      setDocs([]);
    } finally {
      setLoadingList(false);
    }
  }, [listingId]);

  useEffect(() => {
    // Standard "fetch on mount" effect — loadDocs() sets `loadingList` before
    // its first await so the spinner shows immediately. Data fetching is one
    // of the cases https://react.dev/learn/you-might-not-need-an-effect
    // explicitly says still needs an effect, so this is an intentional
    // exception to the rule below, not a bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocs();
  }, [loadDocs]);

  async function upload() {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setStatus(null);
    setCommand(null);
    try {
      const fd = new FormData();
      fd.append("listingId", listingId);
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Upload failed");
      setStatus({
        kind: "ok",
        text: `Staged ${data.saved?.length ?? 0} PDF(s) in ./${data.dir}. Run the command below to index them, then Refresh.`,
      });
      setCommand(data.command ?? null);
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Upload */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Add documents</h2>
        <p className="mt-1 text-xs text-slate-500">
          Stage PDFs for listing <span className="font-mono text-slate-700">{listingId || "—"}</span>,
          then index them with the ingestion pipeline (parse → chunk → embed → store).
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            onClick={upload}
            disabled={uploading || files.length === 0 || !listingId.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {uploading ? "Staging…" : `Stage${files.length ? ` (${files.length})` : ""}`}
          </button>
        </div>

        {status && (
          <p
            className={`mt-3 text-sm ${status.kind === "ok" ? "text-emerald-700" : "text-rose-700"}`}
          >
            {status.text}
          </p>
        )}

        {command && (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 px-4 py-3 font-mono text-xs leading-relaxed text-slate-100">
            {command}
          </pre>
        )}

        <p className="mt-3 text-xs text-slate-400">
          Ingestion runs as a separate Python pipeline (it parses tables, chunks, and embeds). The
          sample dataset is already indexed for <span className="font-mono">demo-listing-001</span>.
        </p>
      </section>

      {/* Document list */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Indexed documents{" "}
            <span className="text-slate-400">{loadingList ? "" : `(${docs.length})`}</span>
          </h2>
          <button
            onClick={loadDocs}
            className="text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
          >
            Refresh
          </button>
        </div>

        {loadingList ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-slate-400">
            No documents indexed for this listing yet. Stage PDFs above and run the ingestion command.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${
                    DOC_TYPE_STYLES[d.docType] ?? DOC_TYPE_STYLES.OTHER
                  }`}
                >
                  {d.docType}
                </span>
                <span className="truncate text-sm font-medium text-slate-900">{d.title}</span>
                <span className="ml-auto shrink-0 text-xs text-slate-400">
                  {d.chunkCount} chunks · {new Date(d.uploadedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
