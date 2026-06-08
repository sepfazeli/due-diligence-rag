-- Migration: init
--
-- Creates the Document and Chunk tables, enables the pgvector extension, adds the
-- vector(1536) embedding column, and creates two indexes Prisma cannot express:
--   1. an ivfflat index for cosine-similarity ANN search (vector retrieval)
--   2. a GIN full-text index on content (the lexical half of hybrid retrieval, Phase 4)
--
-- The CREATE TABLE / enum / FK / btree-index statements below are exactly what
-- `prisma migrate diff` generates from prisma/schema.prisma; the pgvector bits
-- are added by hand (see note in schema.prisma).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Enable pgvector — MUST run before the vector(1536) column in "Chunk" below.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('FINANCIALS', 'DISCLOSURE', 'LISTING', 'OTHER');

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "docType" "DocType" NOT NULL DEFAULT 'OTHER',
    "listingId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPath" TEXT NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documentId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1536),

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_listingId_idx" ON "Document"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_listingId_title_key" ON "Document"("listingId", "title");

-- CreateIndex
CREATE INDEX "Chunk_documentId_idx" ON "Chunk"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_documentId_chunkIndex_key" ON "Chunk"("documentId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- pgvector: approximate-nearest-neighbour index for COSINE similarity.
-- ivfflat partitions vectors into `lists` cells. For best recall, (re)build this
-- AFTER bulk-loading embeddings, and size `lists` ≈ sqrt(#rows) (use ~4*sqrt for
-- very large corpora). 100 is a sensible default for a small/medium corpus.
-- Cosine queries use the `<=>` operator with vector_cosine_ops.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX "Chunk_embedding_ivfflat_idx"
    ON "Chunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- Full-text search: GIN index over an English tsvector of the chunk content.
-- Used by the lexical half of hybrid retrieval in Phase 4
-- (to_tsvector('english', content) @@ plainto_tsquery('english', $query)).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX "Chunk_content_fts_idx"
    ON "Chunk" USING GIN (to_tsvector('english', "content"));
