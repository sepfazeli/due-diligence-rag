import { prisma } from "@/lib/prisma";
import { clientKey, rateLimit, rateLimitResponse, sweepExpired } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/documents?listingId=... — list documents ingested for a listing.
export async function GET(req: Request): Promise<Response> {
  sweepExpired();
  const rl = rateLimit(`documents:${clientKey(req)}`, 60, 60_000); // 60 req/min per IP
  if (!rl.ok) return rateLimitResponse(rl);

  const listingId = new URL(req.url).searchParams.get("listingId");
  if (!listingId) {
    return Response.json({ error: "listingId query param is required" }, { status: 400 });
  }

  try {
    const docs = await prisma.document.findMany({
      where: { listingId },
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        title: true,
        docType: true,
        uploadedAt: true,
        _count: { select: { chunks: true } },
      },
    });

    return Response.json({
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        docType: d.docType,
        uploadedAt: d.uploadedAt.toISOString(),
        chunkCount: d._count.chunks,
      })),
    });
  } catch (err) {
    console.error("[/api/documents] error:", err);
    const detail = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "Failed to list documents", detail }, { status: 500 });
  }
}