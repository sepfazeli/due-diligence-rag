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
2. `lib/retrieval.ts` runs **hybrid retrieval** — pgvector cosine similarity +
   Postgres full-text search on `content`, always filtered by `listingId` —
   then reranks the top ~20 candidates with **Cohere Rerank** and keeps the top 5.
3. `app/api/analyze/route.ts` builds context from those chunks (carrying their
   metadata for citations) and calls **Claude** with a strict diligence-assistant
   system prompt that forces structured JSON output.
4. **Guardrail:** if the top rerank score is below threshold, the route returns a
   low-confidence *"not enough information"* response **without** calling the model
   on weak context.

---

## Tech stack

| Layer        | Choice                                             |
| ------------ | -------------------------------------------------- |
| App / UI     | Next.js (App Router) + TypeScript + Tailwind CSS   |
| Database     | Neon Postgres + `pgvector`                         |
| ORM          | Prisma (vector column added via raw SQL migration) |
| Ingestion    | Python (`/ingestion`)                              |
| LLM          | Anthropic Claude (`@anthropic-ai/sdk`)             |
| Embeddings   | OpenAI `text-embedding-3-small` (1536 dims)        |
| Reranking    | Cohere Rerank                                      |

---

## Project structure

```
due-diligence-rag/
├── app/                  # Next.js App Router (UI + API routes)
│   └── api/analyze/      # (Phase 5) analysis endpoint
├── lib/                  # (Phase 4) retrieval.ts, prisma client, etc.
├── prisma/               # (Phase 2) schema + migrations
├── ingestion/            # Python ingestion pipeline
│   ├── ingest.py         # (Phase 3) PDF → chunks → embeddings → Postgres
│   ├── requirements.txt
│   └── sample_docs/      # synthetic test PDFs (Phase 3)
├── .env.example          # template — copy to .env and fill in
├── .gitignore
└── README.md
```

---

## The three hard problems (and how this project handles them)

1. **Table-aware chunking** — Financial tables are kept intact as single chunks
   with their section heading rather than being blindly split across token
   windows, so figures stay with their labels.
2. **Hybrid + rerank retrieval** — Vector similarity alone misses exact terms
   (account names, line items); full-text alone misses paraphrase. We combine
   both, then rerank with Cohere for precision.
3. **Numerical reasoning with citations** — The model is instructed to extract
   the relevant figures from the chunks *first*, state them explicitly, then
   reason — and every output claim carries a citation back to a source
   document + page.

A **confidence guardrail** sits in front of the model: weak retrieval ⇒ an
explicit "not enough information" answer instead of a hallucinated one.

---

## Setup

Full setup instructions (filling `.env`, running the migration, running
ingestion, starting the dev server, and Vercel deployment env vars) are added in
**Phase 7**. For now:

```bash
cp .env.example .env   # then fill in the four keys
npm install
npm run dev
```
