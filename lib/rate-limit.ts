// A minimal, dependency-free rate limiter.
//
// NOTE ON SERVERLESS: this state lives in the Node.js process memory. On
// Vercel, each function instance has its own memory, so the effective limit
// is "N requests per warm instance", not a single global counter across the
// whole deployment. That's an acceptable tradeoff for a low-traffic project.
// For strict, multi-instance-accurate limiting, swap this module for
// Upstash Redis (`@upstash/ratelimit` + `@upstash/redis`) or Vercel KV.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, limit, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (bucket.count >= limit) {
    return { ok: false, limit, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { ok: true, limit, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

// Called opportunistically so the Map doesn't grow unbounded on long-lived
// instances. Cheap: only actually sweeps once a minute.
let lastSweep = Date.now();
export function sweepExpired(): void {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}