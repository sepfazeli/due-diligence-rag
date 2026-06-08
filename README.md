# due-diligence-rag

A RAG-powered document analysis assistant for business due diligence.

Upload a business's documents (financial statements, seller disclosures, listing
details), ask a plain-language question, and get back a **grounded answer**, a
list of **risk flags**, a short **financial summary**, and **citations** that
point to the exact source document and page.

Every claim is traceable to a retrieved chunk. If retrieval quality is low, the
assistant says **"I don't have enough information"** instead of guessing.

> ⚠️ **Not financial or legal advice.** This is a diligence *assistant* that
> surfaces and cites what is in your documents. It does not give advice.

---

## Architecture overview

```
                ┌──────────────────────────────────────────────────────┐
                │                  INGESTION (Python)                    │
   PDFs  ─────▶ │  pdfplumber → table-aware chunking (tiktoken ~512/50) │
   + listingId  │  → OpenAI embeddings (text-embedding-3-small)         │
                │  → upsert chunks + metadata into Postgres             │
                └───────────────────────────┬──────────────────────────┘
                                             │
                                  ┌──────────▼───────────┐
                                  │  Neon Postgres        │
                                  │  + pgvector(1536)     │
                                  │  + tsvector full-text │
                                  └──────────┬───────────┘
                                             │
                ┌────────────────────────────▼─────────────────────────┐
                │                  APP (Next.js, App Router)             │
   question ──▶ │  lib/retrieval.ts:  hybrid search (vector + FTS,      │
   + listingId  │     filtered by listingId) → Cohere Rerank → top 5    │
                │  app/api/analyze:   build cited context → Claude →    │
                │     strict JSON { answer, riskFlags, financialMetrics,│
                │     citations, confidence }  (+ low-confidence guard) │
                │  UI: upload view, question box, results panel         │
                └───────────────────────────────────────────────────────┘
```

### Request flow (analysis)
1. User asks a question scoped to a `listingId`.
2. [`lib/retrieval.ts`](lib/retrieval.ts) runs **hybrid retrieval** — pgvector cosine
   similarity + Postgres full-text search on `content`, always filtered by
   `listingId` — fuses them with Reciprocal Rank Fusion, then reranks the top ~20
   candidates with **Cohere Rerank** and keeps the top 5.
3. [`app/api/analyze/route.ts`](app/api/analyze/route.ts) → [`lib/analyze.ts`](lib/analyze.ts)
   builds context from those chunks (carrying their metadata for citations) and
   calls **Claude Sonnet** with a strict diligence-assistant system prompt and
   forced, strict tool use that guarantees structured JSON output.
4. **Guardrail:** if the top rerank score is below threshold, the route returns a
   low-confidence *"not enough information"* response **without** calling the model
   on weak context.

---

## Tech stack

| Layer        | Choice                                                       |
| ------------ | ----------------------------------------------------------- |
| App / UI     | Next.js 16 (App Router) + TypeScript + Tailwind CSS v4       |
| Database     | Neon Postgres + `pgvector`                                   |
| ORM          | Prisma 7 (vector column via raw SQL; `@prisma/adapter-pg`)   |
| Ingestion    | Python (`/ingestion`)                                        |
| LLM          | Anthropic Claude — `claude-sonnet-4-6` (`@anthropic-ai/sdk`) |
| Embeddings   | OpenAI `text-embedding-3-small` (1536 dims)                  |
| Reranking    | Cohere Rerank (`rerank-v3.5`)                                |

---

## The three hard problems (and how this project handles them)

1. **Table-aware chunking** — Financial tables are detected with
   `pdfplumber.find_tables()`, extracted as a unit, and kept **intact as a single
   chunk** with their section heading; table regions are removed from the prose so
   figures aren't split across token windows or duplicated. Prose is chunked by
   section to ~512 tokens with ~50 token overlap (counted with `tiktoken`). See
   [`ingestion/ingest.py`](ingestion/ingest.py).

2. **Hybrid + rerank retrieval** — Vector similarity alone misses exact terms
   (account names, line items); full-text alone misses paraphrase. We run both
   (pgvector `<=>` cosine + Postgres `tsvector`), fuse with **Reciprocal Rank
   Fusion**, then **Cohere Rerank** the merged candidates for precision. Always
   scoped to one `listingId`. See [`lib/retrieval.ts`](lib/retrieval.ts).

3. **Numerical reasoning with citations** — The model is instructed to extract the
   relevant figures from the chunks *first*, state them explicitly, then reason —
   and every output claim carries a citation back to a source document + page.
   Structured output is guaranteed via Claude **strict tool use**. See
   [`lib/analyze.ts`](lib/analyze.ts).

### The confidence guardrail
Cohere returns a normalized relevance score per chunk. Before calling the LLM,
the analyze route checks the **top rerank score**: if it's below
`ANALYZE_MIN_SCORE` (default `0.05`), it returns an explicit *"not enough
information"* response with `confidence: "low"` and **does not call the model**.
Measured separation: legitimate questions score ~0.18–0.82 at the top; off-topic
questions score ~0.01.

---

## Project structure

```
due-diligence-rag/
├── app/
│   ├── api/analyze/route.ts     # POST { question, listingId } → analysis JSON
│   ├── api/documents/route.ts   # GET ?listingId= → indexed documents
│   ├── api/upload/route.ts      # POST PDFs → stage for ingestion (dev only)
│   ├── layout.tsx, page.tsx     # app shell + tabbed UI
│   └── globals.css
├── components/                  # Disclaimer, AnalyzePanel, DocumentsPanel
├── lib/
│   ├── prisma.ts                # Prisma 7 client (driver adapter)
│   ├── retrieval.ts             # hybrid search + Cohere rerank
│   ├── analyze.ts               # retrieval → Claude → structured analysis
│   └── types.ts                 # shared, runtime-free types
├── prisma/
│   ├── schema.prisma            # Document, Chunk, DocType
│   └── migrations/…/migration.sql  # pgvector ext + vector(1536) + ivfflat + GIN
├── prisma.config.ts             # Prisma 7 datasource config
├── ingestion/
│   ├── ingest.py                # PDF → chunks → embeddings → Postgres
│   ├── requirements.txt
│   └── sample_docs/             # synthetic test PDFs + generator
├── .env.example                 # copy to .env and fill in
└── README.md
```

---

## Prerequisites

- **Node.js 20+** and npm
- **Python 3.9+** (for the ingestion pipeline)
- A **Neon Postgres** database (free tier is fine) — pgvector is enabled by the migration
- API keys: **OpenAI**, **Anthropic**, **Cohere**

---

## Setup

### 1. Environment variables
```bash
cp .env.example .env
```
Fill in `.env` (never commit it — it's gitignored):

| Key                 | Used for                                                        |
| ------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`      | Neon Postgres — use the **direct/unpooled** connection string  |
| `OPENAI_API_KEY`    | Embeddings (ingestion + query-time)                            |
| `ANTHROPIC_API_KEY` | Claude analysis                                               |
| `COHERE_API_KEY`    | Reranking                                                      |
| `ANALYZE_MIN_SCORE` | *(optional)* guardrail threshold, default `0.05`               |

> **Neon tip:** in the Neon console's "Connect" dialog, turn **off** "Connection
> pooling" and copy the direct string (host without `-pooler`). Prisma 7 dropped
> `directUrl`, so migrations use whatever `DATABASE_URL` points at.

### 2. Install dependencies & apply the database migration
```bash
npm install                 # also runs `prisma generate` (postinstall)
npx prisma migrate deploy   # creates tables, enables pgvector, builds ivfflat + GIN indexes
npx prisma migrate status   # → "Database schema is up to date!"
```

### 3. Set up the Python ingestion pipeline
```bash
cd ingestion
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
cd ..
```

### 4. Ingest documents
The repo ships synthetic sample PDFs so you can test end-to-end immediately:
```bash
./ingestion/venv/bin/python ingestion/ingest.py \
  --docs ./ingestion/sample_docs --listing-id demo-listing-001
```
For your own documents, point `--docs` at a folder of PDFs and choose a `--listing-id`.

### 5. Start the app
```bash
npm run dev
```
Open http://localhost:3000, keep the listing as `demo-listing-001`, and ask a
question (e.g. *"What were revenue, EBITDA, and net income over the last three
years?"*).

---

## Using the API directly

```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"question":"What are the main risks?","listingId":"demo-listing-001"}'
```

Response shape:
```jsonc
{
  "answer": "…grounded prose…",
  "riskFlags": [{ "severity": "red", "title": "…", "detail": "…" }],
  "financialMetrics": { "Revenue (FY2025)": "$1.52M", "EBITDA (FY2025)": "$170k" },
  "citations": [{ "docTitle": "Financials", "page": 1, "snippet": "…" }],
  "confidence": "high",
  "meta": { "model": "claude-sonnet-4-6", "topScore": 0.66, "guardrailTriggered": false, "usedSources": [] }
}
```

---

## Deployment (Vercel)

1. **Push to GitHub** and import the repo in Vercel (it auto-detects Next.js).
2. **Set environment variables** in the Vercel project (Production + Preview):

   | Variable            | Notes                                            |
   | ------------------- | ------------------------------------------------ |
   | `DATABASE_URL`      | Neon connection string (direct/unpooled)         |
   | `OPENAI_API_KEY`    | embeddings                                        |
   | `ANTHROPIC_API_KEY` | Claude                                            |
   | `COHERE_API_KEY`    | rerank                                            |
   | `ANALYZE_MIN_SCORE` | *(optional)* guardrail threshold                  |

3. **Build** — `prisma generate` runs automatically via the `postinstall` script,
   so the client is generated during Vercel's build. No extra build config needed.
4. **Migrations** — run against the production database once (and on schema
   changes): `npx prisma migrate deploy` locally with the prod `DATABASE_URL`, or
   wire it into your release pipeline.
5. **Ingestion is out-of-band.** The Python pipeline needs a real filesystem and a
   Python `venv`, which don't exist on Vercel's serverless functions. The in-app
   `/api/upload` route only **stages** PDFs to `./uploads/<listingId>` for local
   indexing and is **guarded to no-op in serverless**. Run `ingestion/ingest.py`
   from your machine, CI, or a worker with network access to the same
   `DATABASE_URL`; the deployed app then serves analysis over that already-ingested
   data.

---

## Security notes

- `.env` (and `.env.local`, `venv/`, `ingestion/uploads/`) are gitignored — only
  the empty `.env.example` template is committed. Keep real keys out of any
  committed file.
- The analyze route uses parameterized `prisma.$queryRaw` (no string-built SQL),
  and the upload route sanitizes filenames/listing ids before any filesystem use.
- This app handles business documents — prefer a **private** repo and per-listing
  access controls before exposing it beyond a demo.
