// Per-visitor rate limit for the AI routes, to protect free API quotas on a public demo.
// Off unless RATE_LIMIT_PER_HOUR is set (e.g. on Vercel). Counts are kept in memory per
// server instance, which is enough to stop casual overuse (not a hard security boundary).

const WINDOW_MS = 3600_000;
const hits = new Map<string, number[]>();

function clientId(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}

/**
 * Returns a 429 response when this visitor exceeded the hourly limit, else null.
 * `cost` lets heavier calls (job search, salary research) count more than one.
 */
export function rateLimit(req: Request, cost = 1): Response | null {
  const limit = Number(process.env.RATE_LIMIT_PER_HOUR);
  if (!limit) return null;

  const now = Date.now();
  const id = clientId(req);
  const recent = (hits.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length + cost > limit) {
    const retryMin = Math.max(1, Math.ceil((WINDOW_MS - (now - recent[0])) / 60_000));
    return Response.json(
      { error: `Demo limit reached (${limit} AI actions per hour). Try again in ~${retryMin} min, or run JobLens locally for unlimited use.` },
      { status: 429, headers: { "Retry-After": String(retryMin * 60) } },
    );
  }
  for (let i = 0; i < cost; i++) recent.push(now);
  hits.set(id, recent);

  // Keep memory bounded.
  if (hits.size > 5000) for (const [key, times] of hits) if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
  return null;
}
