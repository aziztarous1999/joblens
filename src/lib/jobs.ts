// Fetches offers from free job APIs and normalises them into one `Job` shape.
//
// - Remotive  (remote jobs, no key)          https://remotive.com/api-documentation
// - Arbeitnow (Germany / Europe, no key)     https://www.arbeitnow.com/blog/job-board-api
// - Adzuna    (many countries, free key)     https://developer.adzuna.com
// - Himalayas (remote jobs, no key)          https://himalayas.app/api
// - Jobicy    (remote jobs, no key)          https://jobicy.com/jobs-rss-feed
// - JSearch   (LinkedIn, Indeed, Glassdoor… via Google for Jobs, free RapidAPI key)
// - France Travail and Bundesagentur für Arbeit (official, no monthly quota): see officialJobs.ts
//
// These free APIs ask that results link back to them; every Job keeps its original URL
// and the UI shows the source name.

import { COUNTRIES, countryByCode } from "./countries";
import { fetchBundesagentur, fetchFranceTravail, franceTravailConfigured } from "./officialJobs";
import { filterFakeOffers } from "./quality";
import { dictionaryTerms, languageOf, type SearchTerms } from "./searchTerms";
import { POSTED_WITHIN_HOURS, type ContractType, type Filters, type Job, type HiddenOffer, type PostedWithin, type Schedule, type WorkMode } from "./types";

const UA = { "User-Agent": "cv-job-matcher (portfolio project)" };
// Short cache so "posted in the last hour" sees fresh offers. (Remotive asks for at most
// a few calls a day and delays offers by 24h anyway, so it keeps a long cache.)
const FRESH = { revalidate: 300 };

/** How much each source fetches per search (keeps requests and free quotas in check). */
interface Budget {
  remotiveQueries: number;
  arbeitnowPages: number;
  himalayasPages: number;
  jobicyCount: number;
  adzunaPerPage: number;
  adzunaCountries: number;
  jsearchPages: number;
}
const BUDGET: Budget = { remotiveQueries: 2, arbeitnowPages: 1, himalayasPages: 1, jobicyCount: 50, adzunaPerPage: 30, adzunaCountries: 6, jsearchPages: 1 };
/** Max offers returned to the browser per search. */
export const MAX_RESULTS = 100;
const MAX_DESCRIPTION = 4000;

export function stripHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

export function detectWorkMode(text: string, remoteFlag?: boolean): Job["workMode"] {
  if (/\bhybrid|hybride|teilweise remote/i.test(text)) return "hybrid";
  if (remoteFlag || /\b(full[- ]?remote|fully remote|100% remote|remote[- ]first|télétravail complet)/i.test(text)) {
    return "remote";
  }
  if (remoteFlag === false) return "onsite";
  return "unknown";
}

const CONTRACT_PATTERNS: Record<Exclude<ContractType, "any" | "permanent">, RegExp> = {
  internship: /\b(intern|internship|stage|stagiaire|praktikum|praktikant(in)?)\b/i,
  apprenticeship: /\b(apprentice|apprenticeship|alternance|alternant|apprenti|ausbildung|werkstudent)/i,
  freelance: /\b(freelance|freelancer|contractor|contract|independent|indépendant|freiberuflich)\b/i,
  fixed_term: /\b(fixed[- ]term|temporary|cdd|befristet|interim|intérim)\b/i,
};

function matchesContract(job: Job, contract: ContractType): boolean {
  if (contract === "any") return true;
  const text = `${job.title} ${job.contract}`;
  if (contract === "permanent") {
    return !Object.values(CONTRACT_PATTERNS).some((re) => re.test(text));
  }
  // Title + contract fields only: descriptions mention "international", "internal", etc.
  return CONTRACT_PATTERNS[contract].test(text);
}

function matchesSchedule(job: Job, schedule: Schedule): boolean {
  if (schedule === "any") return true;
  const partTime = /part[- ]?time|teilzeit|temps partiel/i.test(`${job.contract} ${job.title}`);
  return schedule === "part_time" ? partTime : !partTime;
}

function matchesPosted(job: Job, within: PostedWithin): boolean {
  if (!within || within === "any") return true;
  if (!job.postedAt) return false;
  const posted = Date.parse(job.postedAt);
  // A date in the future means the source's clock or timezone is wrong: don't trust it.
  if (Number.isNaN(posted) || posted > Date.now() + 10 * 60_000) return false;
  return Date.now() - posted <= POSTED_WITHIN_HOURS[within] * 3600_000;
}

// Offers that mention relocation help or visa sponsorship (EN / FR / DE).
const RELOCATION =
  /\b(relocat\w*|visa sponsor\w*|sponsor(ship)? (a |your )?visa|work permit support|aide (à la|au) (relocalisation|déménagement)|relocalisation|prise en charge du déménagement|umzugs(hilfe|unterstützung|kosten)|visa ?(support|assistance|unterstützung))\b/i;

export function mentionsRelocation(job: Pick<Job, "title" | "description">): boolean {
  return RELOCATION.test(`${job.title} ${job.description}`);
}

function matchesWorkMode(job: Job, mode: WorkMode): boolean {
  if (mode === "any") return true;
  // Keep "unknown" so users can decide from the description.
  return job.workMode === mode || job.workMode === "unknown";
}

function matchesCountry(job: Job, code: string): boolean {
  if (code === "any") return true;
  const country = countryByCode(code);
  if (!country) return true;
  const loc = job.location.toLowerCase();
  if (!loc || /worldwide|anywhere|global/.test(loc)) return true;
  return [country.name.toLowerCase(), ...country.aliases].some((a) => loc.includes(a));
}

// Words too generic to decide whether an offer is relevant.
const GENERIC = new Set(["junior", "senior", "mid", "lead", "level", "entry", "the", "and", "for", "with", "job", "jobs", "remote", "h/f", "m/w/d", "f/h"]);

export function keywordTokens(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[\s,/()+-]+/)
    .filter((w) => w.length >= 2 && !GENERIC.has(w));
}

/**
 * Local keyword filter for sources that have no search parameter. An offer matches when every
 * meaningful word of at least one keyword appears in its title or description, so
 * "Junior Frontend Developer" also matches "Frontend Software Developer (m/w/d)".
 */
function matchesKeywords(job: Job, keywords: string[]): boolean {
  const lists = keywords.map(keywordTokens).filter((t) => t.length > 0);
  if (lists.length === 0) return true;
  const hay = `${job.title} ${job.description}`.toLowerCase();
  return lists.some((tokens) => tokens.every((t) => hay.includes(t)));
}

// ---------- Sources ----------

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
}

async function fetchRemotive(keywords: string[], budget: Budget): Promise<Job[]> {
  const queries = keywords.length ? keywords.slice(0, budget.remotiveQueries) : [""];
  const results = await Promise.all(
    queries.map(async (q) => {
      const url = `https://remotive.com/api/remote-jobs?limit=50&search=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: UA, next: { revalidate: 6 * 3600 } });
      if (!res.ok) throw new Error(`Remotive ${res.status}`);
      const data = (await res.json()) as { jobs: RemotiveJob[] };
      return data.jobs;
    }),
  );
  return results.flat().map((j) => ({
    id: `remotive-${j.id}`,
    source: "remotive" as const,
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || "Worldwide",
    workMode: "remote" as const,
    contract: j.job_type.replace("_", " "),
    salary: j.salary || undefined,
    url: j.url,
    // Remotive dates have no timezone; they are UTC.
    postedAt: /(Z|[+-]\d\d:?\d\d)$/i.test(j.publication_date) ? j.publication_date : `${j.publication_date}Z`,
    description: stripHtml(j.description),
  }));
}

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
}

async function fetchArbeitnow(keywords: string[], budget: Budget): Promise<Job[]> {
  // No search parameter: fetch the two newest pages and filter locally.
  const pages = await Promise.all(
    Array.from({ length: budget.arbeitnowPages }, (_, i) => i + 1).map(async (page) => {
      const res = await fetch(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, {
        headers: UA,
        next: FRESH,
      });
      if (!res.ok) throw new Error(`Arbeitnow ${res.status}`);
      return ((await res.json()) as { data: ArbeitnowJob[] }).data;
    }),
  );
  const jobs = pages.flat().map((j) => {
    const description = stripHtml(j.description);
    return {
      id: `arbeitnow-${j.slug}`,
      source: "arbeitnow" as const,
      title: j.title,
      company: j.company_name,
      location: j.location ? `${j.location}, Germany` : "Germany",
      workMode: detectWorkMode(description, j.remote),
      contract: j.job_types.join(", "),
      url: j.url,
      postedAt: new Date(j.created_at * 1000).toISOString(),
      description,
    };
  });
  return jobs.filter((j) => matchesKeywords(j, keywords));
}

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  redirect_url: string;
  created: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  contract_type?: string;
  contract_time?: string;
}

// Adzuna's `created` is the country's local wall-clock time wrongly marked "Z"
// (France shows 17:07Z at 15:07 UTC), so convert it using the country's timezone.
const ADZUNA_TZ: Record<string, string> = {
  fr: "Europe/Paris", de: "Europe/Berlin", gb: "Europe/London", es: "Europe/Madrid", it: "Europe/Rome",
  nl: "Europe/Amsterdam", be: "Europe/Brussels", ch: "Europe/Zurich", at: "Europe/Vienna", pl: "Europe/Warsaw",
  us: "America/New_York", ca: "America/Toronto", au: "Australia/Sydney", in: "Asia/Kolkata",
  sg: "Asia/Singapore", br: "America/Sao_Paulo",
};

function adzunaDate(created: string, countryCode: string): string {
  const tz = ADZUNA_TZ[countryCode];
  return tz ? wallClockToUtc(created, tz) : created;
}

/** Converts a local wall-clock time (with or without a wrong "Z") in timezone `tz` to real UTC. */
export function wallClockToUtc(local: string, tz: string): string {
  const wall = Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(local) ? local : `${local}Z`);
  if (Number.isNaN(wall)) return local;
  // Offset of `tz` from UTC at that moment (handles summer time).
  const asUtc = new Date(new Date(wall).toLocaleString("en-US", { timeZone: "UTC" }));
  const asTz = new Date(new Date(wall).toLocaleString("en-US", { timeZone: tz }));
  const utc = wall - (asTz.getTime() - asUtc.getTime());
  return new Date(Math.min(utc, Date.now())).toISOString();
}

export const adzunaConfigured = () => Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);

// Countries searched when no country is chosen (on-site and relocation offers abroad).
// One request per country keeps within Adzuna's free daily quota.
export const ADZUNA_WIDE = ["fr", "de", "gb", "nl", "be", "es", "ch", "ca"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Searches several countries one after another (Adzuna rate-limits parallel bursts). */
async function fetchAdzunaWide(filters: Filters, terms: SearchTerms): Promise<{ jobs: Job[]; failed: string[] }> {
  const jobs: Job[] = [];
  const failed: string[] = [];
  for (const code of ADZUNA_WIDE.slice(0, BUDGET.adzunaCountries)) {
    try {
      // Each country in its own language, plus the English titles (common in tech offers).
      const keywords = [...terms[languageOf(code)].slice(0, 2), ...terms.en.slice(0, 2)];
      jobs.push(...(await fetchAdzuna({ ...filters, keywords }, code, true)));
    } catch {
      failed.push(code.toUpperCase());
    }
    await sleep(250);
  }
  return { jobs, failed };
}

/**
 * Searches one Adzuna country. With `wide`, sends a single request that matches ANY of the
 * keywords' words (`what_or`) instead of one request per keyword.
 */
async function fetchAdzuna(filters: Filters, countryCode: string, wide = false): Promise<Job[]> {
  const country = countryByCode(countryCode);
  if (!adzunaConfigured() || !country?.adzuna) return [];

  const words = [...new Set(filters.keywords.flatMap(keywordTokens))].slice(0, 6);
  const queries = wide ? [words.join(" ")] : filters.keywords.length ? filters.keywords.slice(0, 3) : [""];
  const results = await Promise.all(
    queries.map(async (q) => {
      const params = new URLSearchParams({
        app_id: process.env.ADZUNA_APP_ID!,
        app_key: process.env.ADZUNA_APP_KEY!,
        results_per_page: String(BUDGET.adzunaPerPage),
      });
      params.set(wide ? "what_or" : "what", q);
      // Adzuna only returns a short snippet, so let its full-text search enforce relocation.
      if (filters.relocation) params.set("what_and", "relocation");
      // Adzuna already searches by keyword (in the local language), so no local keyword filter.
      if (filters.contract === "permanent") params.set("permanent", "1");
      if (filters.contract === "freelance" || filters.contract === "fixed_term") params.set("contract", "1");
      if (filters.schedule === "full_time") params.set("full_time", "1");
      if (filters.schedule === "part_time") params.set("part_time", "1");
      if (filters.postedWithin && filters.postedWithin !== "any") {
        params.set("max_days_old", String(Math.ceil(POSTED_WITHIN_HOURS[filters.postedWithin] / 24)));
        params.set("sort_by", "date");
      }
      const url = `https://api.adzuna.com/v1/api/jobs/${country.code}/search/1?${params}`;
      let res = await fetch(url, { headers: UA, next: FRESH });
      if (res.status === 429) {
        await sleep(1500); // per-minute rate limit: wait and retry once
        res = await fetch(url, { headers: UA, next: FRESH });
      }
      if (!res.ok) throw new Error(`Adzuna ${res.status}${res.status === 429 ? " (rate limit, retry in a minute)" : ""}`);
      return ((await res.json()) as { results: AdzunaJob[] }).results;
    }),
  );

  return results.flat().map((j) => {
    const description = stripHtml(j.description);
    const salary =
      j.salary_min && j.salary_max
        ? `${Math.round(j.salary_min).toLocaleString()} – ${Math.round(j.salary_max).toLocaleString()} (Adzuna estimate)`
        : undefined;
    return {
      id: `adzuna-${j.id}`,
      source: "adzuna" as const,
      title: stripHtml(j.title),
      company: j.company?.display_name ?? "Unknown company",
      location: `${j.location?.display_name ?? ""}, ${country.name}`,
      workMode: detectWorkMode(`${j.title} ${description}`),
      contract: [j.contract_type, j.contract_time].filter(Boolean).join(", ").replace(/_/g, " "),
      salary,
      url: j.redirect_url,
      postedAt: adzunaDate(j.created, country.code),
      dateKind: "seen" as const, // Adzuna's import time, not the employer's posting date
      description,
      relocation: filters.relocation || undefined,
    };
  });
}

interface HimalayasJob {
  guid: string;
  title: string;
  companyName: string;
  excerpt: string;
  description: string;
  employmentType: string;
  seniority?: string[];
  locationRestrictions: string[];
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  applicationLink: string;
  pubDate: number;
}

async function fetchHimalayas(keywords: string[], budget: Budget): Promise<Job[]> {
  // The main feed is newest-first; read 3 pages (cursor pagination) and filter locally.
  const raw: HimalayasJob[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < budget.himalayasPages; page++) {
    const url = `https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, { headers: UA, next: FRESH });
    if (!res.ok) throw new Error(`Himalayas ${res.status}`);
    const data = (await res.json()) as { jobs: HimalayasJob[]; nextCursor?: string | null };
    raw.push(...data.jobs);
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  const jobs = raw.map((j) => ({
    id: `himalayas-${j.guid}`,
    source: "himalayas" as const,
    title: j.title,
    company: j.companyName,
    location: j.locationRestrictions.length ? j.locationRestrictions.join(", ") : "Worldwide",
    workMode: "remote" as const,
    contract: [j.employmentType, ...(j.seniority ?? [])].filter(Boolean).join(", "),
    salary:
      j.minSalary && j.maxSalary
        ? `${j.minSalary.toLocaleString()} – ${j.maxSalary.toLocaleString()} ${j.currency ?? ""}`.trim()
        : undefined,
    url: j.applicationLink,
    postedAt: new Date(j.pubDate * 1000).toISOString(),
    description: stripHtml(j.description || j.excerpt),
  }));
  return jobs.filter((j) => matchesKeywords(j, keywords));
}

interface JobicyJob {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobType: string[];
  jobGeo: string;
  jobLevel: string;
  jobExcerpt: string;
  jobDescription: string;
  pubDate: string;
}

// Jobicy's `geo` values for the countries it supports.
const JOBICY_GEO: Record<string, string> = {
  us: "usa", gb: "uk", fr: "france", de: "germany", ca: "canada", es: "spain", it: "italy", nl: "netherlands",
  pl: "poland", ie: "ireland", pt: "portugal", be: "belgium", ch: "switzerland", at: "austria", au: "australia",
  in: "india", br: "brazil",
};

async function fetchJobicy(keywords: string[], country: string, budget: Budget): Promise<Job[]> {
  const geo = JOBICY_GEO[country];
  const res = await fetch(`https://jobicy.com/api/v2/remote-jobs?count=${budget.jobicyCount}${geo ? `&geo=${geo}` : ""}`, {
    headers: UA,
    next: FRESH,
  });
  if (!res.ok) throw new Error(`Jobicy ${res.status}`);
  const data = (await res.json()) as { jobs?: JobicyJob[] };
  const jobs = (data.jobs ?? []).map((j) => ({
    id: `jobicy-${j.id}`,
    source: "jobicy" as const,
    title: stripHtml(j.jobTitle),
    company: j.companyName,
    location: j.jobGeo || "Worldwide",
    workMode: "remote" as const,
    contract: [...(j.jobType ?? []), j.jobLevel].filter(Boolean).join(", "),
    url: j.url,
    postedAt: j.pubDate,
    description: stripHtml(j.jobDescription || j.jobExcerpt),
  }));
  return jobs.filter((j) => matchesKeywords(j, keywords));
}

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name?: string | null;
  job_publisher?: string | null;
  job_employment_type?: string | null;
  job_apply_link: string;
  job_description?: string | null;
  job_is_remote?: boolean | null;
  job_posted_at_datetime_utc?: string | null;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_currency?: string | null;
  job_salary_period?: string | null;
  job_salary_string?: string | null;
  job_location?: string | null;
  /** Every site the offer is published on, e.g. LinkedIn, Indeed, the company site. */
  apply_options?: { publisher?: string; apply_link?: string; is_direct?: boolean }[];
}

// Preferred sites when an offer is published on several (first match wins).
const PREFERRED_PUBLISHERS = [/linkedin/i, /indeed/i, /glassdoor/i, /welcome to the jungle/i, /apec/i, /hellowork/i];

export const jsearchConfigured = () => Boolean(process.env.RAPIDAPI_KEY);

const JSEARCH_DATE: Record<Exclude<PostedWithin, "any">, string> = { "1h": "today", "2h": "today", "6h": "today", "1d": "today", "3d": "3days" };
const JSEARCH_TYPE: Partial<Record<ContractType, string>> = { internship: "INTERN", freelance: "CONTRACTOR", fixed_term: "CONTRACTOR" };

/**
 * LinkedIn, Indeed, Glassdoor and other boards via JSearch (Google for Jobs data on RapidAPI).
 * Free plan: ~100 requests/month, so results are cached for an hour and pages are budgeted.
 */
async function fetchJSearch(filters: Filters, countryCode: string | undefined, budget: Budget): Promise<Job[]> {
  const country = countryCode ? countryByCode(countryCode) : undefined;
  const type = filters.schedule === "part_time" ? "PARTTIME" : (JSEARCH_TYPE[filters.contract] ?? (filters.schedule === "full_time" ? "FULLTIME" : ""));

  // One request per keyword: /search-v2 returns nothing for "A OR B" queries.
  // Only the first 2 keywords, to spare the ~100 requests/month free quota (responses are cached 1h).
  const queries = filters.keywords.length ? filters.keywords.slice(0, 2) : ["jobs"];
  const lists = await Promise.all(
    queries.map(async (query) => {
      const params = new URLSearchParams({ query, page: "1", num_pages: String(budget.jsearchPages) });
      if (country) params.set("country", country.code);
      if (filters.postedWithin && filters.postedWithin !== "any") params.set("date_posted", JSEARCH_DATE[filters.postedWithin]);
      if (filters.workMode === "remote") params.set("work_from_home", "true");
      if (type) params.set("employment_types", type);

      // JSearch renamed /search to /search-v2 (the old path now returns 404).
      const res = await fetch(`https://jsearch.p.rapidapi.com/search-v2?${params}`, {
        headers: { "X-RapidAPI-Key": process.env.RAPIDAPI_KEY!, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
        next: { revalidate: 3600 },
      });
      if (res.status === 403) throw new Error("not subscribed: open rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch and subscribe to the free Basic plan");
      if (res.status === 429) throw new Error("monthly free quota used up");
      if (!res.ok) throw new Error(`JSearch ${res.status}`);
      // v2 returns { data: { jobs, cursor } }; v1 returned { data: [...] }.
      const body = (await res.json()) as { data?: JSearchJob[] | { jobs?: JSearchJob[] } };
      return Array.isArray(body.data) ? body.data : (body.data?.jobs ?? []);
    }),
  );
  const list = lists.flat();

  return list.map((j) => {
    const description = stripHtml(j.job_description ?? "");
    // Link to LinkedIn / Indeed / Glassdoor when the offer is also published there.
    const options = j.apply_options ?? [];
    const preferred = PREFERRED_PUBLISHERS.map((re) => options.find((o) => re.test(o.publisher ?? "") && o.apply_link)).find(Boolean);
    const countryName = j.job_country ? (countryByCode(j.job_country.toLowerCase())?.name ?? j.job_country) : "";
    const sameAsCountry = (v?: string | null) => !v || v === j.job_country || v === countryName;
    const place = [j.job_city, j.job_state].filter(Boolean).join(", ") || (sameAsCountry(j.job_location) ? "" : j.job_location!);
    return {
      id: `jsearch-${j.job_id}`,
      source: "jsearch" as const,
      publisher: preferred?.publisher ?? j.job_publisher ?? undefined,
      title: j.job_title,
      company: j.employer_name ?? "",
      location: [place, countryName].filter(Boolean).join(", ") || (j.job_is_remote ? "Remote" : ""),
      workMode: j.job_is_remote ? ("remote" as const) : detectWorkMode(`${j.job_title} ${description}`, false),
      contract: (j.job_employment_type ?? "").toLowerCase().replace(/_/g, " "),
      salary:
        j.job_min_salary && j.job_max_salary
          ? `${j.job_min_salary.toLocaleString()} – ${j.job_max_salary.toLocaleString()} ${j.job_salary_currency ?? ""} ${j.job_salary_period ? `/ ${j.job_salary_period.toLowerCase()}` : ""}`.trim()
          : (j.job_salary_string ?? undefined),
      url: preferred?.apply_link ?? j.job_apply_link,
      postedAt: j.job_posted_at_datetime_utc ?? undefined,
      dateKind: "seen" as const, // Google for Jobs' "x days ago", counted from its last indexing
      description,
    };
  });
}

/** Country of the candidate, from free-text location like "Lyon, France". */
export function countryFromLocation(location: string): string | undefined {
  const loc = location.toLowerCase();
  return COUNTRIES.find((c) => loc.includes(c.name.toLowerCase()) || c.aliases.some((a) => a.length > 3 && !["europe", "emea", "africa", "apac", "asia", "latam", "north america", "middle east"].includes(a) && loc.includes(a)))?.code;
}

// ---------- Public API ----------

export interface SearchResult {
  jobs: Job[];
  warnings: string[];
  /** Offers that matched every filter except the date one. */
  beforeDateFilter: number;
  /** Most recent posting date among those, to explain an empty date-filtered result. */
  newestPostedAt?: string;
  /** Offers removed by the fake/spam filter. */
  hidden: HiddenOffer[];
}

/**
 * Searches every selected source. `terms` holds the keywords per language (AI-expanded job titles,
 * see searchTerms.ts); each source is queried in the language its offers are written in.
 */
export async function searchJobs(filters: Filters, homeCountry?: string, terms: SearchTerms = dictionaryTerms(filters.keywords)): Promise<SearchResult> {
  const warnings: string[] = [];
  const budget = BUDGET;
  const kw = (keywords: string[]): Filters => ({ ...filters, keywords: [...new Set(keywords)] });
  const allLanguages = [...terms.en, ...terms.fr, ...terms.de];
  const countryLang = languageOf(filters.country !== "any" ? filters.country : homeCountry);
  const tasks: Promise<Job[]>[] = [];
  const names: string[] = [];

  const add = (name: string, task: () => Promise<Job[]>) => {
    names.push(name);
    tasks.push(task());
  };

  if (filters.sources.includes("remotive") && filters.workMode !== "onsite" && filters.workMode !== "hybrid") {
    add("Remotive", () => fetchRemotive(terms.en, budget));
  }
  const remoteOk = filters.workMode === "any" || filters.workMode === "remote";
  if (filters.sources.includes("arbeitnow") && ["any", "de"].includes(filters.country)) {
    add("Arbeitnow", () => fetchArbeitnow([...terms.de, ...terms.en], budget));
  }
  // Feeds filtered locally: accept a title in any language.
  if (filters.sources.includes("himalayas") && remoteOk) add("Himalayas", () => fetchHimalayas(allLanguages, budget));
  if (filters.sources.includes("jobicy") && remoteOk) add("Jobicy", () => fetchJobicy(allLanguages, filters.country, budget));
  // Official national services: France when France or no country is chosen, Germany likewise.
  if (filters.sources.includes("francetravail") && ["any", "fr"].includes(filters.country)) {
    if (!franceTravailConfigured()) warnings.push("France Travail is off: add FRANCE_TRAVAIL_CLIENT_ID and FRANCE_TRAVAIL_CLIENT_SECRET to .env.local (free).");
    else add("France Travail", () => fetchFranceTravail(kw(terms.fr)));
  }
  if (filters.sources.includes("bundesagentur") && ["any", "de"].includes(filters.country) && filters.workMode !== "remote") {
    add("Bundesagentur für Arbeit", () => fetchBundesagentur(kw(terms.de)));
  }
  if (filters.sources.includes("jsearch")) {
    if (!jsearchConfigured()) warnings.push("LinkedIn / Indeed (JSearch) is off: add a free RAPIDAPI_KEY to .env.local.");
    // No country chosen: search the candidate's own country (JSearch needs one country per request).
    // 2 requests per search (free quota): the top local-language title + the top English one.
    else {
      const local = countryLang === "en" ? terms.en.slice(1, 2) : terms[countryLang].slice(0, 1);
      add("LinkedIn / Indeed (JSearch)", () =>
        fetchJSearch(kw([...local, ...terms.en.slice(0, 1)]), filters.country !== "any" ? filters.country : homeCountry, budget),
      );
    }
  }
  if (filters.sources.includes("adzuna")) {
    if (!adzunaConfigured()) warnings.push("Adzuna is off: add ADZUNA_APP_ID and ADZUNA_APP_KEY to .env.local (needed for on-site offers outside Germany).");
    else if (filters.country === "any") {
      add("Adzuna", async () => {
        const { jobs, failed } = await fetchAdzunaWide(filters, terms);
        if (failed.length) warnings.push(`Adzuna skipped ${failed.join(", ")} (rate limit or error); retry in a minute.`);
        return jobs;
      });
    } else if (!countryByCode(filters.country)?.adzuna) warnings.push("Adzuna does not cover this country.");
    else add("Adzuna", () => fetchAdzuna(kw([...terms[languageOf(filters.country)].slice(0, 2), ...terms.en.slice(0, 1)]), filters.country));
  }

  const settled = await Promise.allSettled(tasks);
  const all: Job[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") all.push(...r.value);
    else warnings.push(`${names[i]} failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  });

  // Keywords are already applied per source (by the API's own search, or locally for feeds).
  const seen = new Set<string>();
  const candidates = all.filter((job) => {
    const key = `${job.title}|${job.company}`.toLowerCase();
    if (seen.has(key) || seen.has(job.id)) return false;
    seen.add(key);
    seen.add(job.id);
    return (
      matchesCountry(job, filters.country) &&
      matchesWorkMode(job, filters.workMode) &&
      matchesContract(job, filters.contract) &&
      matchesSchedule(job, filters.schedule)
    );
  });
  for (const job of candidates) job.relocation = job.relocation || mentionsRelocation(job);
  // With a date filter, offers whose real posting date is unknown can't be trusted to be recent.
  const dateFilter = !!filters.postedWithin && filters.postedWithin !== "any";
  const unverified = dateFilter ? candidates.filter((j) => j.dateKind === "seen").length : 0;
  if (unverified) {
    warnings.push(
      `${unverified} offer(s) from LinkedIn/Indeed (JSearch) or Adzuna were left out: those sources only know when an offer was last indexed, not when it was posted. Choose “Any time” to see them.`,
    );
  }
  const { kept: jobs, hidden } = filterFakeOffers(
    candidates.filter(
      (job) =>
        (!dateFilter || job.dateKind !== "seen") &&
        matchesPosted(job, filters.postedWithin) &&
        (!filters.relocation || job.relocation),
    ),
  );
  const newestPostedAt = candidates
    .map((j) => j.postedAt)
    .filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  return { jobs, warnings, beforeDateFilter: candidates.length, newestPostedAt, hidden };
}

/** Cheap local pre-ranking so only the most relevant offers are sent to the AI. */
export function prerank(jobs: Job[], skills: string[]): Job[] {
  const terms = skills.map((s) => s.toLowerCase()).filter((s) => s.length > 1);
  const score = (job: Job) => {
    const title = job.title.toLowerCase();
    const body = job.description.toLowerCase();
    return terms.reduce((acc, t) => acc + (title.includes(t) ? 3 : 0) + (body.includes(t) ? 1 : 0), 0);
  };
  return [...jobs].sort((a, b) => score(b) - score(a));
}
