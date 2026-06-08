# Dealworthy

> **Know if it's worth it.**

AI-powered due diligence for small business acquisitions. Upload deal documents, ask plain-language questions, get back grounded answers, risk flags, a financial summary, and citations that point to the exact source.

🔗 **Live at [dealworthy.tech](https://dealworthy.tech)**

---

## What it does

You're evaluating a small business acquisition. You have PDFs (financials, seller disclosures, listing details), maybe a website URL, maybe a broker email. Dealworthy indexes all of it and lets you ask questions in plain English:

> *"What are the main risks for this business?"*
> *"How have revenue and margins trended over the last three years?"*
> *"Is there customer concentration risk?"*

Every answer is grounded in the documents you provided — with citations back to the exact source and page — or Dealworthy says *"I don't have enough information"* instead of guessing.

---

## Features

- **Three ingestion modes** — PDF upload, URL import (any public page via Jina reader), or paste raw text
- **Fully serverless pipeline** — no Python, no separate ingestion step; documents are parsed, chunked, and embedded in-process on upload
- **Hybrid retrieval** — pgvector cosine similarity + Postgres full-text search, fused with Reciprocal Rank Fusion, then reranked by Cohere
- **Structured analysis** — Claude returns strict JSON: answer prose, risk flags (red / amber), financial metrics, citations, confidence level
- **Confidence guardrail** — if retrieval quality is below threshold the model is not called; you get an honest low-confidence response
- **Dynamic suggestions** — example questions are generated from your actual indexed documents, not hardcoded
- **Workspace isolation** — each visitor gets their own workspace ID; documents are scoped per workspace, nothing leaks between users
- **Full theming** — light / dark / system mode + 5 accent colour presets; no flash on load (SSR-safe inline script)

---

## Architecture

```
Documents (PDF / URL / Text)
        │
        ├── /api/upload        pdf-parse → text
        ├── /api/ingest-url    Jina reader → markdown
        └── /api/ingest-text   raw text
                │
                └── lib/ingest.ts
                      chunkText() → embedAll() → Neon pgvector

Question + workspaceId
        │
        └── /api/analyze
              │
              ├── lib/retrieval.ts
              │     pgvector cosine  ─┐
              │     Postgres FTS      ├─ RRF → Cohere Rerank → top 5 chunks
              │     (scoped to workspace)┘
              │
              └── lib/analyze.ts
                    Build cited context → Claude Sonnet (strict tool use)
                    → { answer, riskFlags, financialMetrics, citations, confidence }
```

---

## Tech stack

| Layer | Choice |
|---|---|
| App / UI | Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Framer Motion |
| Database | Neon Postgres + `pgvector` (1536-dim) |
| ORM | Prisma 7 · `@prisma/adapter-pg` · vector columns via raw SQL |
| Ingestion | Node.js in-process · `pdf-parse` · Jina AI reader |
| Analysis LLM | Anthropic `claude-sonnet-4-6` (structured output via strict tool use) |
| Suggestions LLM | Anthropic `claude-haiku-4-5` |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| Reranking | Cohere `rerank-v3.5` |
| Deployment | Vercel |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-username/dealworthy.git
cd dealworthy
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres — use the **direct (unpooled)** connection string |
| `OPENAI_API_KEY` | Embeddings at ingest and query time |
| `ANTHROPIC_API_KEY` | Claude analysis + suggestion generation |
| `COHERE_API_KEY` | Reranking |
| `ANALYZE_MIN_SCORE` | *(optional)* guardrail threshold, default `0.05` |

> **Neon tip:** in the Neon console's "Connect" dialog, turn **off** "Connection pooling" and copy the direct string. Prisma 7 requires a non-pooled URL.

### 3. Apply the database migration

```bash
npx prisma migrate deploy
npx prisma migrate status   # → "Database schema is up to date!"
```

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). A demo dataset is pre-indexed under workspace `demo-listing-001` on the hosted version. Locally, switch to any workspace ID and upload your own documents.

---

## Ingestion API

All three routes return the same shape:

```json
{ "ok": true, "indexed": [{ "title": "...", "chunks": 42 }], "totalChunks": 42 }
```

**PDF upload**
```bash
curl -X POST http://localhost:3000/api/upload \
  -F "listingId=my-workspace" \
  -F "files=@financials.pdf"
```

**URL import**
```bash
curl -X POST http://localhost:3000/api/ingest-url \
  -H "Content-Type: application/json" \
  -d '{"listingId":"my-workspace","url":"https://example.com/listing"}'
```

**Text paste**
```bash
curl -X POST http://localhost:3000/api/ingest-text \
  -H "Content-Type: application/json" \
  -d '{"listingId":"my-workspace","title":"Broker Email","text":"..."}'
```

---

## Analysis API

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"question":"What are the main risks?","listingId":"my-workspace"}'
```

Response:

```jsonc
{
  "answer": "…grounded prose…",
  "riskFlags": [
    { "severity": "red", "title": "Supplier concentration", "detail": "…" }
  ],
  "financialMetrics": {
    "Revenue (FY2024)": "$1.52M",
    "EBITDA (FY2024)": "$170k"
  },
  "citations": [
    { "docTitle": "Financials.pdf", "page": 3, "snippet": "…" }
  ],
  "confidence": "high",
  "meta": {
    "model": "claude-sonnet-4-6",
    "topScore": 0.66,
    "guardrailTriggered": false,
    "usedSources": [1, 2, 4]
  }
}
```

---

## Project structure

```
dealworthy/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts        # POST → analysis JSON
│   │   ├── documents/route.ts      # GET  → indexed docs list
│   │   ├── ingest-text/route.ts    # POST → index raw text
│   │   ├── ingest-url/route.ts     # POST → fetch URL + index
│   │   ├── suggestions/route.ts    # GET  → LLM-generated example questions
│   │   └── upload/route.ts         # POST → index PDFs
│   ├── settings/page.tsx           # theme picker
│   ├── icon.tsx                    # favicon (generated via next/og)
│   ├── apple-icon.tsx              # iOS touch icon (generated)
│   ├── opengraph-image.tsx         # OG card (generated)
│   ├── layout.tsx                  # root layout + no-flash theme script
│   ├── page.tsx                    # main app shell + workspace logic
│   └── globals.css                 # CSS custom properties + Tailwind v4 theme
├── components/
│   ├── AnalyzePanel.tsx            # question box + results + empty state
│   ├── DocumentsPanel.tsx          # PDF / URL / text ingestion tabs
│   ├── Disclaimer.tsx
│   ├── Logo.tsx
│   └── ThemeToggle.tsx
├── context/
│   └── ThemeContext.tsx            # light / dark / system + 5 accent presets
├── lib/
│   ├── analyze.ts                  # retrieval → Claude → structured output
│   ├── ingest.ts                   # shared chunk / embed / store pipeline
│   ├── prisma.ts                   # Prisma 7 client (driver adapter)
│   ├── retrieval.ts                # hybrid search + Cohere rerank
│   └── types.ts                    # shared TypeScript types
└── prisma/
    ├── schema.prisma
    └── migrations/
```

---

## Deployment

Designed for Vercel. Everything runs serverless — no separate ingestion worker.

1. Push to GitHub and import the repo in Vercel (auto-detects Next.js).
2. Add the four environment variables in Vercel project settings (Production + Preview).
3. `prisma generate` runs automatically on every build via the `postinstall` script.
4. Run `npx prisma migrate deploy` once against your production database.
5. Deploy — then upload documents directly from the UI.

---

## Security notes

- `.env` and `.env.local` are gitignored — only `.env.example` is committed.
- All database queries use parameterised Prisma calls or `$executeRawUnsafe` with positional `$N` bindings (no string-interpolated SQL).
- Documents are scoped strictly to their `listingId`; cross-workspace access is not possible at the query level.
- Consider a **private repo** and adding authentication before sharing with clients.

---

## License

MIT
