#!/usr/bin/env python3
"""
ingest.py — due-diligence-rag ingestion pipeline.

Parses a folder of PDFs and loads them into Postgres as embedded, cited chunks:

  1. Parse each PDF with pdfplumber (prose text + tables, per page).
  2. Chunk:
       - financial TABLES are kept intact as a single chunk (tagged with the
         section heading) — they are NOT split across token windows.
       - prose is split by section, then token-windowed to ~512 tokens with
         ~50 token overlap (counted with tiktoken).
  3. Embed each chunk with OpenAI text-embedding-3-small (1536-dim).
  4. Upsert the Document and replace its Chunks in Postgres (idempotent
     re-ingest), storing all metadata (page, section, chunkIndex) + the
     pgvector embedding.

Usage:
    python ingest.py --listing-id demo-listing-001
    python ingest.py --docs ./sample_docs --listing-id demo-listing-001

Reads OPENAI_API_KEY and DATABASE_URL from the project-root .env.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber
import psycopg
import tiktoken
from dotenv import load_dotenv
from openai import OpenAI, OpenAIError

# ── config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

EMBED_MODEL = "text-embedding-3-small"
MAX_TOKENS = 512
OVERLAP_TOKENS = 50
EMBED_BATCH = 96

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ingest")


@dataclass
class Chunk:
    content: str
    page: int
    section: str
    kind: str  # "table" | "prose"
    embedding: list = field(default_factory=list)


# ── PDF parsing (table-aware) ───────────────────────────────────────────────────
def is_heading(line: str) -> bool:
    """A short, mostly-uppercase line with no trailing period = a section heading."""
    s = line.strip()
    if not s or len(s) > 60:
        return False
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 2:
        return False
    upper_ratio = sum(c.isupper() for c in letters) / len(letters)
    return upper_ratio >= 0.8 and not s.endswith(".")


def table_to_text(table) -> str:
    """Render a pdfplumber table as intact pipe-delimited rows."""
    rows = []
    for row in table:
        cells = [(c or "").strip().replace("\n", " ") for c in row]
        if any(cells):
            rows.append(" | ".join(cells))
    return "\n".join(rows)


def parse_pdf(path: Path):
    """Yield {page, prose, tables, headings} per page, with table regions removed
    from the prose so table text is not duplicated."""
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            found = page.find_tables()
            if found:
                bboxes = [t.bbox for t in found]

                def outside(obj):
                    cx = (obj["x0"] + obj["x1"]) / 2
                    cy = (obj["top"] + obj["bottom"]) / 2
                    return not any(
                        x0 <= cx <= x1 and top <= cy <= bottom
                        for (x0, top, x1, bottom) in bboxes
                    )

                prose = page.filter(outside).extract_text() or ""
                tables = [t.extract() for t in found]
            else:
                prose = page.extract_text() or ""
                tables = []
            headings = [ln.strip() for ln in prose.splitlines() if is_heading(ln)]
            yield {"page": i, "prose": prose, "tables": tables, "headings": headings}


# ── chunking ────────────────────────────────────────────────────────────────────
def get_encoder():
    try:
        return tiktoken.encoding_for_model(EMBED_MODEL)
    except KeyError:
        return tiktoken.get_encoding("cl100k_base")


def chunk_by_tokens(text: str, enc, max_tokens=MAX_TOKENS, overlap=OVERLAP_TOKENS):
    toks = enc.encode(text)
    if not toks:
        return []
    out, start = [], 0
    while start < len(toks):
        end = min(start + max_tokens, len(toks))
        piece = enc.decode(toks[start:end]).strip()
        if piece:
            out.append(piece)
        if end >= len(toks):
            break
        start = end - overlap  # slide back to create overlap
    return out


def split_sections(prose: str, seed_section: str):
    """Split prose into (section, text) pairs by detected headings. Returns the
    pairs plus the trailing section name to carry onto the next page."""
    sections, current, buf = [], seed_section, []
    for line in prose.splitlines():
        if is_heading(line):
            if buf:
                sections.append((current, "\n".join(buf).strip()))
                buf = []
            current = line.strip().title()
        else:
            buf.append(line)
    if buf:
        sections.append((current, "\n".join(buf).strip()))
    return [(s, t) for s, t in sections if t], current


def build_chunks(path: Path, enc) -> list:
    chunks: list = []
    current_section = "Overview"
    for pg in parse_pdf(path):
        page_no = pg["page"]
        # tables: each kept intact as one chunk, tagged with the page's first heading
        table_section = pg["headings"][0].title() if pg["headings"] else current_section
        for tbl in pg["tables"]:
            text = table_to_text(tbl)
            if text.strip():
                chunks.append(Chunk(content=text, page=page_no, section=table_section, kind="table"))
        # prose: split by section, then token-window each section
        sections, current_section = split_sections(pg["prose"], current_section)
        for sec_name, sec_text in sections:
            for piece in chunk_by_tokens(sec_text, enc):
                chunks.append(Chunk(content=piece, page=page_no, section=sec_name, kind="prose"))
    return chunks


# ── embeddings ──────────────────────────────────────────────────────────────────
def embed_chunks(client: OpenAI, chunks: list) -> None:
    for i in range(0, len(chunks), EMBED_BATCH):
        batch = chunks[i : i + EMBED_BATCH]
        resp = client.embeddings.create(model=EMBED_MODEL, input=[c.content for c in batch])
        for c, d in zip(batch, resp.data):
            c.embedding = d.embedding
        log.info("  embedded %d/%d chunks", min(i + EMBED_BATCH, len(chunks)), len(chunks))


# ── DB ──────────────────────────────────────────────────────────────────────────
def infer_doc_type(name: str) -> str:
    n = name.lower()
    if any(k in n for k in ("financ", "income", "balance", "pnl", "p&l", "statement")):
        return "FINANCIALS"
    if any(k in n for k in ("disclos", "seller")):
        return "DISCLOSURE"
    if any(k in n for k in ("listing", "memo", "cim", "overview", "teaser")):
        return "LISTING"
    return "OTHER"


def vector_literal(emb: list) -> str:
    """pgvector text format: '[0.1,0.2,...]' — inserted with an explicit ::vector
    cast so we don't depend on numpy / pgvector's psycopg adapter."""
    return "[" + ",".join(map(str, emb)) + "]"


def upsert_document(conn, *, title, doc_type, listing_id, raw_path, chunks: list):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO "Document" (title, "docType", "listingId", "rawPath")
            VALUES (%s, %s::"DocType", %s, %s)
            ON CONFLICT ("listingId", title)
            DO UPDATE SET "docType" = EXCLUDED."docType", "rawPath" = EXCLUDED."rawPath"
            RETURNING id
            """,
            (title, doc_type, listing_id, raw_path),
        )
        doc_id = cur.fetchone()[0]
        # replace this document's chunks so re-ingestion is idempotent
        cur.execute('DELETE FROM "Chunk" WHERE "documentId" = %s', (doc_id,))
        for idx, c in enumerate(chunks):
            cur.execute(
                """
                INSERT INTO "Chunk"
                    ("documentId", content, page, section, "chunkIndex", embedding)
                VALUES (%s, %s, %s, %s, %s, %s::vector)
                """,
                (doc_id, c.content, c.page, c.section, idx, vector_literal(c.embedding)),
            )
    conn.commit()
    return doc_id


# ── main ────────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest a folder of PDFs into the RAG store.")
    ap.add_argument(
        "--docs",
        default=str(Path(__file__).resolve().parent / "sample_docs"),
        help="folder containing PDFs (default: ./sample_docs)",
    )
    ap.add_argument("--listing-id", required=True, help="listing these documents belong to")
    args = ap.parse_args()

    docs_dir = Path(args.docs).resolve()
    pdfs = sorted(docs_dir.glob("*.pdf"))
    if not pdfs:
        log.error("no PDFs found in %s", docs_dir)
        sys.exit(1)

    for var in ("OPENAI_API_KEY", "DATABASE_URL"):
        if not os.environ.get(var):
            log.error("missing %s (set it in %s)", var, PROJECT_ROOT / ".env")
            sys.exit(1)

    enc = get_encoder()
    oai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    log.info("ingesting %d PDF(s) from %s for listing '%s'", len(pdfs), docs_dir, args.listing_id)
    total_chunks = 0
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        for pdf_path in pdfs:
            title = pdf_path.stem.replace("_", " ").replace("-", " ").title()
            doc_type = infer_doc_type(pdf_path.name)
            log.info("→ %s  [%s]", pdf_path.name, doc_type)
            chunks = build_chunks(pdf_path, enc)
            n_tables = sum(1 for c in chunks if c.kind == "table")
            log.info(
                "  parsed into %d chunks (%d table, %d prose)",
                len(chunks),
                n_tables,
                len(chunks) - n_tables,
            )
            if not chunks:
                log.warning("  no extractable content, skipping")
                continue
            try:
                embed_chunks(oai, chunks)
            except OpenAIError as e:
                log.error("OpenAI embeddings failed: %s", e)
                log.error(
                    "If this says 'insufficient_quota', add a payment method / credits "
                    "at https://platform.openai.com/account/billing and re-run."
                )
                sys.exit(1)
            doc_id = upsert_document(
                conn,
                title=title,
                doc_type=doc_type,
                listing_id=args.listing_id,
                raw_path=str(pdf_path),
                chunks=chunks,
            )
            total_chunks += len(chunks)
            log.info("  upserted document %s with %d chunks", doc_id, len(chunks))

    log.info(
        "done — %d chunks across %d document(s) for listing '%s'",
        total_chunks,
        len(pdfs),
        args.listing_id,
    )


if __name__ == "__main__":
    main()
