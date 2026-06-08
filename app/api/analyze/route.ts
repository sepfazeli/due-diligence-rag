import { analyze } from "@/lib/analyze";

// Prisma + node-postgres require the Node.js runtime (not Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { question, listingId } = (body ?? {}) as { question?: unknown; listingId?: unknown };
  if (typeof question !== "string" || !question.trim()) {
    return Response.json({ error: "'question' (non-empty string) is required." }, { status: 400 });
  }
  if (typeof listingId !== "string" || !listingId.trim()) {
    return Response.json({ error: "'listingId' (non-empty string) is required." }, { status: 400 });
  }

  try {
    const result = await analyze(question, listingId);
    return Response.json(result);
  } catch (err) {
    console.error("[/api/analyze] error:", err);
    const detail = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "Analysis failed", detail }, { status: 500 });
  }
}
