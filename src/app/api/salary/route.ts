import { errorResponse, languageInstruction, requireProvider } from "@/lib/ai";
import { rateLimit } from "@/lib/rateLimit";
import type { Job, OutputLanguage, Profile } from "@/lib/types";

export const maxDuration = 300;

const SYSTEM = `You are a compensation analyst. Use web search to research real, current data, and cite every number.

Preferred sources, in order:
1. Salary data: Glassdoor, Levels.fyi (tech), Indeed Salaries, Payscale, LinkedIn Salary, Talent.com, and for France APEC, Welcome to the Jungle salary studies, Hays/Michael Page salary guides.
2. Official statistics: INSEE (FR), Destatis (DE), ONS (UK), BLS (US), Eurostat, Statistics Canada.
3. Cost of living: Numbeo, Expatistan, official rent observatories.
Avoid anonymous blogs and content farms. If sources disagree, say so. If data is thin, say how confident you are.

Answer in Markdown with exactly these sections:
## Salary range for this role
A table: Source | Low | Median | High | Notes (gross annual, local currency, and the experience level it applies to). Then one line with the overall estimate for THIS candidate's level.
## Cost of living in <city>
A table of key monthly costs for one person (rent 1-bedroom city centre / outside centre, utilities, transport, food) and the total monthly budget.
## What it means for you
Approximate net monthly pay after tax and social contributions for the median salary (state that it is approximate), what is left after living costs, and whether the offer's salary (if given) is below, at or above the market.
## Suggested range to ask for
A concrete range plus a one-sentence negotiation tip.

Keep it under 450 words. Do not add a sources list: the app appends one.`;

export async function POST(req: Request) {
  const limited = rateLimit(req, 2);
  if (limited) return limited;
  try {
    const { job, profile, country, language } = (await req.json()) as {
      job: Job;
      profile: Profile | null;
      country: string;
      language: OutputLanguage;
    };
    if (!job) return Response.json({ error: "Missing job" }, { status: 400 });

    const prompt = [
      "Estimate the salary for this job offer and the cost of living where it is based.",
      `<job_offer>\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location} (${job.workMode})\nContract: ${job.contract}\nSalary stated in offer: ${job.salary ?? "not stated"}\n\n${job.description.slice(0, 2500)}\n</job_offer>`,
      profile
        ? `<candidate>\nSeniority: ${profile.seniority}, ${profile.years_experience} years of experience\nHeadline: ${profile.headline}\nCurrent location: ${profile.location}\n</candidate>`
        : "",
      job.workMode === "remote"
        ? "The job is remote: use the candidate's current location for cost of living, and mention if the employer's pay band depends on location."
        : "",
      languageInstruction(language),
    ]
      .filter(Boolean)
      .join("\n\n");

    // City used for salary and cost of living: the job's, or the candidate's for remote roles.
    const place = (job.workMode === "remote" && profile?.location ? profile.location : job.location) || profile?.location || "";
    const city = place.split(",")[0].trim() || place;
    const role = job.title.replace(/\(.*?\)/g, "").trim();
    const queries = [
      `${role} salary ${city} glassdoor`,
      `${role} average salary ${place} ${new Date().getFullYear()}`,
      `cost of living ${city} numbeo monthly rent`,
    ];
    const q = encodeURIComponent;
    const fallbackLinks = [
      { title: `Glassdoor: ${role} salaries`, url: `https://www.glassdoor.com/Search/results.htm?keyword=${q(`${role} salary ${city}`)}` },
      { title: `Indeed: ${role} salaries`, url: `https://www.indeed.com/career/salaries?q=${q(role)}&l=${q(city)}` },
      { title: `Payscale: ${role}`, url: `https://www.payscale.com/research/US/Job=${q(role.replace(/\s+/g, "_"))}/Salary` },
      { title: "Levels.fyi (tech roles)", url: "https://www.levels.fyi/" },
      { title: `Numbeo: cost of living in ${city}`, url: `https://www.numbeo.com/cost-of-living/in/${q(city.replace(/\s+/g, "-"))}` },
    ];

    const result = await requireProvider().research({ system: SYSTEM, prompt, country, queries, fallbackLinks });
    return Response.json({ ...result, markdown: result.markdown.trim() });
  } catch (error) {
    return errorResponse(error);
  }
}
