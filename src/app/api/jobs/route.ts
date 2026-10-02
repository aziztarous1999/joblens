import * as z from "zod/v4";
import { errorResponse, requireProvider } from "@/lib/ai";
import { countryFromLocation, MAX_RESULTS, prerank, searchJobs } from "@/lib/jobs";
import { expandSearchTerms } from "@/lib/searchTerms";
import type { Filters, HiddenOffer, Job, Match, Profile } from "@/lib/types";

export const maxDuration = 300;

// The AI scores the most relevant offers; the rest are still listed, unscored.
// Cloud models: 3 pages of 15, in batches of 15 sent 3 at a time.
// Local model (Ollama): 2 batches of 8, one after the other, to fit its context window and GPU.
const SCORING = {
  cloud: { max: 45, batch: 15, parallel: 3, descChars: 1500 },
  local: { max: 16, batch: 8, parallel: 1, descChars: 900 },
};

const MatchSchema = z.object({
  matches: z.array(
    z.object({
      id: z.string(),
      score: z.number().describe("0-100 fit between the candidate and the offer"),
      verdict: z.string().describe("One sentence explaining the score"),
      strengths: z.array(z.string()).describe("Up to 3 reasons the candidate fits"),
      gaps: z.array(z.string()).describe("Up to 3 missing requirements"),
      suspicious: z.boolean().describe("true only if the offer is very likely fake, a scam, MLM or spam (not just low quality)"),
      suspicious_reason: z.string().describe("Short reason when suspicious, else empty"),
    }),
  ),
});

type ScoredMatch = Match & { suspicious: boolean; suspicious_reason: string };

async function scoreBatch(profile: Profile, jobs: Job[], descChars: number): Promise<ScoredMatch[]> {
  if (jobs.length === 0) return [];
  const offers = jobs
    .map(
      (j) =>
        `<offer id="${j.id}">\nTitle: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location} (${j.workMode})\nContract: ${j.contract}\n${j.description.slice(0, descChars)}\n</offer>`,
    )
    .join("\n");

  const result = await requireProvider().json({
    schema: MatchSchema,
    effort: "low",
    system:
      "You are a strict, honest recruiter. Score how well a candidate fits each job offer. " +
      "Weigh required skills, seniority, years of experience, languages and location rules. " +
      "90+ = excellent fit, 70-89 = good, 50-69 = stretch, below 50 = poor. Return one entry per offer id. " +
      "Also flag offers that are very likely fake: scams (asking for money or bank details, unrealistic pay, chat-app hiring), " +
      "MLM, or spam re-posts with no real employer. Do not flag legitimate offers just because they are vague or a poor fit.",
    input: { text: `<candidate>\n${profile.cv_markdown}\n</candidate>\n\n<offers>\n${offers}\n</offers>` },
  });
  return result.matches;
}

/** Scores offers in batches, a few at a time. A failed batch leaves its offers unscored. */
async function scoreJobs(profile: Profile, jobs: Job[]): Promise<{ matches: ScoredMatch[]; failed: number }> {
  const cfg = requireProvider().local ? SCORING.local : SCORING.cloud;
  const top = jobs.slice(0, cfg.max);
  const batches: Job[][] = [];
  for (let i = 0; i < top.length; i += cfg.batch) batches.push(top.slice(i, i + cfg.batch));

  const matches: ScoredMatch[] = [];
  let failed = 0;
  let firstError: unknown;
  for (let i = 0; i < batches.length; i += cfg.parallel) {
    const settled = await Promise.allSettled(batches.slice(i, i + cfg.parallel).map((b) => scoreBatch(profile, b, cfg.descChars)));
    for (const r of settled) {
      if (r.status === "fulfilled") matches.push(...r.value);
      else {
        failed++;
        firstError ??= r.reason;
      }
    }
  }
  // Nothing scored at all: surface the real error (e.g. Ollama not running).
  if (batches.length > 0 && failed === batches.length) throw firstError;
  return { matches, failed };
}

export async function POST(req: Request) {
  try {
    const { filters, profile } = (await req.json()) as { filters: Filters; profile: Profile | null };
    const limit = MAX_RESULTS;
    const home = profile ? countryFromLocation(profile.location) : undefined;
    // Job titles per language (AI, cached 24h; dictionary fallback), so every source is searched in its language.
    const terms = await expandSearchTerms(filters.keywords, profile);
    const { jobs, warnings, beforeDateFilter, newestPostedAt, hidden } = await searchJobs(filters, home, terms);
    const meta = { warnings, total: jobs.length, beforeDateFilter, newestPostedAt, searchTerms: terms };

    if (!profile) return Response.json({ jobs: jobs.slice(0, limit), matches: [], hidden, ...meta });

    // Most relevant first; the top ones go to the AI, then everything is ordered by score.
    const ranked = prerank(jobs, [...filters.keywords, ...terms.fr, ...terms.de, ...profile.skills]).slice(0, limit);
    const { matches: results, failed } = await scoreJobs(profile, ranked);
    if (failed) warnings.push(`${failed} batch(es) of offers could not be scored by the AI and are listed unscored.`);

    // Second fake-offer check: offers the AI flags are removed and listed with the reason.
    const flagged = new Map(results.filter((m) => m.suspicious).map((m) => [m.id, m.suspicious_reason || "flagged by AI"]));
    const aiHidden: HiddenOffer[] = ranked
      .filter((j) => flagged.has(j.id))
      .map((j) => ({ title: j.title, company: j.company, url: j.url, reason: `AI: ${flagged.get(j.id)}` }));
    const matches: Match[] = results
      .filter((m) => !m.suspicious)
      .map(({ id, score, verdict, strengths, gaps }) => ({ id, score, verdict, strengths, gaps }));
    const byId = new Map(matches.map((m) => [m.id, m]));
    const kept = ranked.filter((j) => !flagged.has(j.id));
    const scored = kept.filter((j) => byId.has(j.id)).sort((a, b) => byId.get(b.id)!.score - byId.get(a.id)!.score);
    const unscored = kept.filter((j) => !byId.has(j.id));

    return Response.json({
      jobs: [...scored, ...unscored],
      matches,
      hidden: [...hidden, ...aiHidden],
      ...meta,
      total: jobs.length - aiHidden.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
