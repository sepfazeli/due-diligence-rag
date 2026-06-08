import { mkdir, writeFile } from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/upload — multipart form { listingId, files[] }.
//
// Stages uploaded PDFs into ./uploads/<listingId>/ and returns the exact command
// to index them with the Python ingestion pipeline. We intentionally do NOT run
// Python here: ingestion is an out-of-band pipeline (it needs the venv + a real
// filesystem), and shelling into ingestion/venv would pull that tree into the
// build. Production ingestion runs separately — see the README.
export async function POST(req: Request): Promise<Response> {
  // Serverless filesystems are ephemeral/read-only — bail before any write.
  if (process.env.VERCEL || process.env.NEXT_RUNTIME === "edge") {
    return Response.json(
      {
        error:
          "File upload needs a writable filesystem and isn't available in this serverless deployment. Run the ingestion pipeline directly — see the README.",
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

  // Template-literal paths (not path.join(process.cwd(), ...)) so the bundler
  // doesn't try to statically trace/include the directory.
  const relDir = `uploads/${safeListing}`;
  const absDir = `${process.cwd()}/${relDir}`;
  await mkdir(absDir, { recursive: true });

  const saved: string[] = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".pdf")) continue;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
    await writeFile(`${absDir}/${safeName}`, Buffer.from(await file.arrayBuffer()));
    saved.push(safeName);
  }
  if (saved.length === 0) {
    return Response.json({ error: "No PDF files found in the upload" }, { status: 400 });
  }

  const command = `./ingestion/venv/bin/python ingestion/ingest.py --docs ./${relDir} --listing-id ${listingId.trim()}`;
  return Response.json({ ok: true, saved, dir: relDir, command });
}
