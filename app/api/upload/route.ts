import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ROOT = process.cwd();

// POST /api/upload — multipart form { listingId, files[] }.
// Saves uploaded PDFs and runs the Python ingestion pipeline against them.
//
// NOTE: this is a LOCAL-DEV convenience — it shells out to the project's Python
// venv (ingestion/venv). In production (e.g. Vercel) there is no venv; run the
// ingestion pipeline separately (see README) and use this app for analysis only.
export async function POST(req: Request): Promise<Response> {
  // Serverless filesystems are ephemeral/read-only and have no Python venv, so the
  // upload→ingest bridge can't run there. Bail out before touching the filesystem;
  // in deployed environments, run the ingestion pipeline out-of-band (see README).
  if (process.env.VERCEL || process.env.NEXT_RUNTIME === "edge") {
    return Response.json(
      {
        error:
          "Web upload + ingestion is a local-development feature (it runs the Python pipeline in ingestion/venv). In this deployment, run the ingestion pipeline separately — see the README.",
      },
      { status: 501 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const listingId = form.get("listingId");
  if (typeof listingId !== "string" || !listingId.trim()) {
    return Response.json({ error: "'listingId' is required" }, { status: 400 });
  }
  const safeListing = listingId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No files uploaded (field 'files')" }, { status: 400 });
  }

  const uploadDir = path.join(ROOT, "ingestion", "uploads", safeListing);
  await mkdir(uploadDir, { recursive: true });

  const saved: string[] = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".pdf")) continue;
    const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
    await writeFile(path.join(uploadDir, safeName), Buffer.from(await file.arrayBuffer()));
    saved.push(safeName);
  }
  if (saved.length === 0) {
    return Response.json({ error: "No PDF files found in the upload" }, { status: 400 });
  }

  // Run the Python ingestion pipeline on the uploaded folder.
  const python = path.join(ROOT, "ingestion", "venv", "bin", "python");
  try {
    const { stdout, stderr } = await execFileAsync(
      python,
      [path.join(ROOT, "ingestion", "ingest.py"), "--docs", uploadDir, "--listing-id", listingId.trim()],
      { cwd: ROOT, timeout: 280_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const log = `${stdout}\n${stderr}`
      .split("\n")
      .filter((l) => l.trim() && !/NotOpenSSLWarning|warnings\.warn|urllib3/.test(l))
      .slice(-30)
      .join("\n");
    return Response.json({ ok: true, saved, log });
  } catch (err) {
    console.error("[/api/upload] ingestion failed:", err);
    const e = err as { message?: string; stderr?: string };
    return Response.json(
      {
        ok: false,
        saved,
        error:
          "Files saved, but ingestion failed. Web upload runs the local Python pipeline (ingestion/venv) — ensure it's set up, or run ingestion from the CLI.",
        detail: String(e.stderr || e.message || "unknown error").slice(-1500),
      },
      { status: 500 },
    );
  }
}
