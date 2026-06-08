import { CohereClient } from "cohere-ai";
import OpenAI from "openai";

import { prisma } from "./prisma";

// ── tunables ───────────────────────────────────────────────────────────────────
const EMBED_MODEL = "text-embedding-3-small";
const RERANK_MODEL = "rerank-v3.5";
const CANDIDATE_K = 20; // hybrid candidates fed to the reranker
const TOP_N = 5; // chunks returned after reranking
// RRF constant (60) is inlined in the SQL below — it's a fixed literal, not user input.

// ── lazy clients (constructed on first use so importing this file never throws) ──
let _openai: OpenAI | null = null;
let _cohere: CohereClient | null = null;
const openai = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
const cohere = () => (_cohere ??= new CohereClient({ token: process.env.COHERE_API_KEY }));

// ── types ──────────────────────────────────────────────────────────────────────
export interface Candidate {
  id: string;
  documentId: string;
  docTitle: string;
  docType: string;
  page: number;
  section: string;
  content: string;
  vectorScore: number; // cosine similarity (0..1)
  ftsScore: number; // ts_rank
  hybridScore: number; // reciprocal rank fusion score
}

export interface RetrievedChunk extends Candidate {
  rerankScore: number; // Cohere relevance (0..1)
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  /** Top Cohere rerank score — used by the API route's confidence guardrail. */
  topScore: number | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────────
async function embedQuery(text: string): Promise<number[]> {
  const resp = await openai().embeddings.create({ model: EMBED_MODEL, input: text });
  return resp.data[0].embedding;
}

const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;

/**
 * Hybrid retrieval: pgvector cosine similarity + Postgres full-text search,
 * fused with Reciprocal Rank Fusion into a single ranked list. ALWAYS scoped to
 * a single listingId (via join to Document). Returns up to `candidateK` rows.
 */
export async function hybridSearch(
  question: string,
  listingId: string,
  candidateK = CANDIDATE_K,
): Promise<Candidate[]> {
  const vec = toVectorLiteral(await embedQuery(question));

  return prisma.$queryRaw<Candidate[]>`
    WITH vec AS (
      SELECT c.id,
             ROW_NUMBER() OVER (ORDER BY c.embedding <=> ${vec}::vector) AS rank,
             (1 - (c.embedding <=> ${vec}::vector))::float8 AS score
      FROM "Chunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE d."listingId" = ${listingId} AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vec}::vector
      LIMIT ${candidateK}
    ),
    fts AS (
      SELECT c.id,
             ROW_NUMBER() OVER (
               ORDER BY ts_rank(to_tsvector('english', c.content),
                                plainto_tsquery('english', ${question})) DESC
             ) AS rank,
             ts_rank(to_tsvector('english', c.content),
                     plainto_tsquery('english', ${question}))::float8 AS score
      FROM "Chunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE d."listingId" = ${listingId}
        AND to_tsvector('english', c.content) @@ plainto_tsquery('english', ${question})
      ORDER BY score DESC
      LIMIT ${candidateK}
    ),
    fused AS (
      SELECT COALESCE(v.id, f.id) AS id,
             (COALESCE(1.0 / (60 + v.rank), 0)
              + COALESCE(1.0 / (60 + f.rank), 0))::float8 AS "hybridScore",
             COALESCE(v.score, 0)::float8 AS "vectorScore",
             COALESCE(f.score, 0)::float8 AS "ftsScore"
      FROM vec v
      FULL OUTER JOIN fts f ON v.id = f.id
    )
    SELECT c.id,
           c."documentId",
           d.title          AS "docTitle",
           d."docType"::text AS "docType",
           c.page,
           c.section,
           c.content,
           fused."hybridScore",
           fused."vectorScore",
           fused."ftsScore"
    FROM fused
    JOIN "Chunk" c    ON c.id = fused.id
    JOIN "Document" d ON d.id = c."documentId"
    ORDER BY fused."hybridScore" DESC
    LIMIT ${candidateK}
  `;
}

/**
 * Full retrieval: hybrid search → Cohere Rerank → top N chunks. `topScore` is the
 * best rerank relevance, which the analyze route uses as a confidence guardrail.
 */
export async function retrieve(
  question: string,
  listingId: string,
  opts: { candidateK?: number; topN?: number } = {},
): Promise<RetrievalResult> {
  const candidateK = opts.candidateK ?? CANDIDATE_K;
  const topN = opts.topN ?? TOP_N;

  const candidates = await hybridSearch(question, listingId, candidateK);
  if (candidates.length === 0) return { chunks: [], topScore: null };

  const reranked = await cohere().rerank({
    model: RERANK_MODEL,
    query: question,
    documents: candidates.map((c) => c.content),
    topN: Math.min(topN, candidates.length),
  });

  const chunks: RetrievedChunk[] = reranked.results.map((r) => ({
    ...candidates[r.index],
    rerankScore: r.relevanceScore,
  }));

  return { chunks, topScore: chunks.length ? chunks[0].rerankScore : null };
}
