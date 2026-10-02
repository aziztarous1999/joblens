// Curated job boards, ranked for a profile + filters.
// "competition" is an editorial estimate of how many applicants a typical offer gets:
// niche and official boards usually get far fewer than LinkedIn/Indeed.

import { COUNTRIES } from "./countries";
import { POSTED_WITHIN_HOURS, type ContractType, type Field, type Filters, type Profile } from "./types";

type Level = "low" | "medium" | "high";

export interface JobSite {
  name: string;
  url: string;
  /** Country codes, or "global". */
  regions: string[];
  /** Fields it is strong in, or "all". */
  fields: (Field | "all")[];
  remoteOnly?: boolean;
  contracts?: ContractType[];
  trust: "official" | "high" | "good";
  competition: Level;
  note: string;
}

const EU = ["fr", "de", "es", "it", "nl", "be", "at", "pl", "ie", "pt"];

/** What a board's search page is pre-filled with. */
export interface BoardQuery {
  keywords: string;
  country: string; // code or "any"
  countryName: string; // "" when any
  hours?: number; // posted within, when a date filter is set
}

const e = encodeURIComponent;
const INDEED_DOMAIN: Record<string, string> = { fr: "fr.indeed.com", gb: "uk.indeed.com", de: "de.indeed.com", es: "es.indeed.com", it: "it.indeed.com", nl: "nl.indeed.com", be: "be.indeed.com", ch: "ch.indeed.com", ca: "ca.indeed.com", ma: "ma.indeed.com" };

// Search-page URL builders (public search pages, no API or scraping).
const SEARCH: Record<string, (q: BoardQuery) => string> = {
  "LinkedIn Jobs": (q) =>
    `https://www.linkedin.com/jobs/search/?keywords=${e(q.keywords)}${q.countryName ? `&location=${e(q.countryName)}` : ""}${q.hours ? `&f_TPR=r${q.hours * 3600}` : ""}`,
  Indeed: (q) =>
    `https://${INDEED_DOMAIN[q.country] ?? "www.indeed.com"}/jobs?q=${e(q.keywords)}${q.countryName && !INDEED_DOMAIN[q.country] ? `&l=${e(q.countryName)}` : ""}${q.hours ? `&fromage=${Math.max(1, Math.ceil(q.hours / 24))}` : ""}`,
  "Welcome to the Jungle": (q) =>
    `https://www.welcometothejungle.com/fr/jobs?query=${e(q.keywords)}${q.country !== "any" ? `&refinementList%5Boffices.country_code%5D%5B%5D=${q.country.toUpperCase()}` : ""}`,
  "Station F Job Board": (q) => `https://jobs.stationf.co/search?query=${e(q.keywords)}`,
  "Free-Work": (q) => `https://www.free-work.com/fr/tech-it/jobs?query=${e(q.keywords)}`,
  HelloWork: (q) => `https://www.hellowork.com/fr-fr/emploi/recherche.html?k=${e(q.keywords)}&l=France`,
  APEC: (q) => `https://www.apec.fr/candidat/recherche-emploi.html/emploi?motsCles=${e(q.keywords)}`,
  "France Travail": (q) => `https://candidat.francetravail.fr/offres/recherche?motsCles=${e(q.keywords)}`,
  JobTeaser: (q) => `https://www.jobteaser.com/fr/job-offers?query=${e(q.keywords)}`,
  "We Work Remotely": (q) => `https://weworkremotely.com/remote-jobs/search?term=${e(q.keywords)}`,
  StepStone: (q) => `https://www.stepstone.de/jobs/${e(q.keywords)}`,
  Glassdoor: (q) => `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${e(q.keywords)}`,
  "Jobs That Make Sense": (q) => `https://jobs.makesense.org/fr/s/jobs/all?query=${e(q.keywords)}`,
  Cadremploi: (q) => `https://www.cadremploi.fr/emploi/liste_offres.html?motscles=${e(q.keywords)}`,
  EURES: (q) => `https://eures.europa.eu/eures-apps/searchengine/page/main#keywords=${e(q.keywords)}`,
};

export const JOB_SITES: JobSite[] = [
  // Global generalists
  { name: "LinkedIn Jobs", url: "https://www.linkedin.com/jobs/", regions: ["global"], fields: ["all"], trust: "high", competition: "high", note: "Largest reach. Use the 'Under 10 applicants' filter and apply in the first 48h." },
  { name: "Indeed", url: "https://www.indeed.com/", regions: ["global"], fields: ["all"], trust: "high", competition: "high", note: "Huge volume in most countries. Watch for duplicate or stale posts." },
  { name: "Glassdoor", url: "https://www.glassdoor.com/Job/", regions: ["global"], fields: ["all"], trust: "high", competition: "high", note: "Offers plus company reviews and salary data in one place." },

  // Remote
  { name: "We Work Remotely", url: "https://weworkremotely.com/", regions: ["global"], fields: ["software", "design", "marketing", "sales", "operations"], remoteOnly: true, trust: "high", competition: "medium", note: "One of the oldest paid remote boards, so spam is rare." },
  { name: "Remotive", url: "https://remotive.com/", regions: ["global"], fields: ["software", "data_ai", "design", "marketing", "sales", "operations"], remoteOnly: true, trust: "high", competition: "medium", note: "Hand-curated remote jobs; check the allowed-countries field." },
  { name: "Working Nomads", url: "https://www.workingnomads.com/jobs", regions: ["global"], fields: ["all"], remoteOnly: true, trust: "good", competition: "low", note: "Curated remote feed with less traffic than the big boards." },
  { name: "Remote OK", url: "https://remoteok.com/", regions: ["global"], fields: ["software", "data_ai", "design", "marketing"], remoteOnly: true, trust: "good", competition: "medium", note: "Large remote board that often shows the salary range." },

  // Tech / startups
  { name: "Wellfound (AngelList)", url: "https://wellfound.com/jobs", regions: ["global"], fields: ["software", "data_ai", "design", "marketing", "sales"], trust: "high", competition: "medium", note: "Startups. Shows salary and equity up front, and you can message founders." },
  { name: "Hacker News – Who is hiring", url: "https://news.ycombinator.com/submitted?id=whoishiring", regions: ["global"], fields: ["software", "data_ai"], trust: "good", competition: "low", note: "Monthly thread where you email founders and engineers directly." },
  { name: "Welcome to the Jungle", url: "https://www.welcometothejungle.com/", regions: ["fr", "es", "be", "gb", "us", "de"], fields: ["all"], trust: "high", competition: "medium", note: "Company pages with team videos and clear contract types." },
  { name: "Station F Job Board", url: "https://jobs.stationf.co/", regions: ["fr"], fields: ["software", "data_ai", "design", "marketing", "sales", "operations"], trust: "high", competition: "low", note: "Offers from the 1,000+ startups on the Station F campus in Paris, many of them unadvertised elsewhere." },
  { name: "Jobs That Make Sense", url: "https://jobs.makesense.org/", regions: ["fr", "be"], fields: ["all"], trust: "high", competition: "low", note: "Impact and social-economy jobs (climate, social, health), carefully vetted." },
  { name: "Cadremploi", url: "https://www.cadremploi.fr/", regions: ["fr"], fields: ["all"], trust: "high", competition: "medium", note: "Long-standing French board for managerial and professional roles." },
  { name: "Built In", url: "https://builtin.com/jobs", regions: ["us"], fields: ["software", "data_ai", "design", "marketing", "sales"], trust: "high", competition: "medium", note: "US tech hubs, with salary ranges shown on most offers." },
  { name: "Dice", url: "https://www.dice.com/", regions: ["us"], fields: ["software", "data_ai"], trust: "high", competition: "medium", note: "US tech specialist, strong for contract roles." },
  { name: "aijobs.net", url: "https://aijobs.net/", regions: ["global"], fields: ["data_ai"], trust: "good", competition: "low", note: "Niche board for AI, ML and data jobs." },
  { name: "Dribbble Jobs", url: "https://dribbble.com/jobs", regions: ["global"], fields: ["design"], trust: "high", competition: "medium", note: "Design-focused jobs where your portfolio counts most." },

  // Freelance
  { name: "Malt", url: "https://www.malt.com/", regions: ["fr", "de", "es", "nl", "be"], fields: ["all"], contracts: ["freelance"], trust: "high", competition: "medium", note: "Leading European freelance marketplace." },
  { name: "Free-Work", url: "https://www.free-work.com/", regions: ["fr", "be"], fields: ["software", "data_ai"], contracts: ["freelance", "permanent"], trust: "good", competition: "low", note: "French IT freelance and permanent roles." },
  { name: "Toptal", url: "https://www.toptal.com/", regions: ["global"], fields: ["software", "data_ai", "design", "finance"], contracts: ["freelance"], remoteOnly: true, trust: "high", competition: "low", note: "Vetted network: hard to get in, but little competition once you are accepted." },
  { name: "Upwork", url: "https://www.upwork.com/", regions: ["global"], fields: ["all"], contracts: ["freelance"], trust: "good", competition: "high", note: "Huge volume with a lot of price pressure. Pick a niche." },

  // Students / early career
  { name: "JobTeaser", url: "https://www.jobteaser.com/", regions: ["fr", "de", "es", "it", "be", "ch", "nl"], fields: ["all"], contracts: ["internship", "apprenticeship"], trust: "high", competition: "medium", note: "Linked to university career centres." },
  { name: "La bonne alternance", url: "https://labonnealternance.apprentissage.beta.gouv.fr/", regions: ["fr"], fields: ["all"], contracts: ["apprenticeship"], trust: "official", competition: "low", note: "Government site that also lists companies likely to hire apprentices." },
  { name: "Handshake", url: "https://joinhandshake.com/", regions: ["us", "gb"], fields: ["all"], contracts: ["internship"], trust: "high", competition: "medium", note: "Student and graduate network used by universities." },

  // Official / national
  { name: "EURES", url: "https://eures.europa.eu/", regions: [...EU], fields: ["all"], trust: "official", competition: "low", note: "EU job-mobility portal, useful for moving between EU countries." },
  { name: "France Travail", url: "https://candidat.francetravail.fr/offres/emploi", regions: ["fr"], fields: ["all"], trust: "official", competition: "medium", note: "National French public employment service." },
  { name: "APEC", url: "https://www.apec.fr/", regions: ["fr"], fields: ["all"], trust: "official", competition: "medium", note: "Managerial and executive (cadre) roles, with salary barometers." },
  { name: "HelloWork", url: "https://www.hellowork.com/", regions: ["fr"], fields: ["all"], trust: "high", competition: "medium", note: "Major French generalist board with good regional coverage." },
  { name: "StepStone", url: "https://www.stepstone.de/", regions: ["de", "at", "be", "nl"], fields: ["all"], trust: "high", competition: "medium", note: "Leading German-speaking board." },
  { name: "Arbeitnow", url: "https://www.arbeitnow.com/", regions: ["de"], fields: ["all"], trust: "good", competition: "low", note: "Germany, with filters for English-speaking roles and visa sponsorship." },
  { name: "Bundesagentur für Arbeit", url: "https://www.arbeitsagentur.de/jobsuche/", regions: ["de"], fields: ["all"], trust: "official", competition: "low", note: "Official German job portal." },
  { name: "Reed", url: "https://www.reed.co.uk/", regions: ["gb"], fields: ["all"], trust: "high", competition: "medium", note: "Large UK board, often with salaries." },
  { name: "Civil Service Jobs", url: "https://www.civilservicejobs.service.gov.uk/", regions: ["gb"], fields: ["all"], trust: "official", competition: "medium", note: "UK government roles with salary bands published." },
  { name: "USAJOBS", url: "https://www.usajobs.gov/", regions: ["us"], fields: ["all"], trust: "official", competition: "medium", note: "US federal jobs with pay grades published." },
  { name: "Job Bank", url: "https://www.jobbank.gc.ca/", regions: ["ca"], fields: ["all"], trust: "official", competition: "low", note: "Canadian government board with wage data per region." },
  { name: "jobs.ch", url: "https://www.jobs.ch/", regions: ["ch"], fields: ["all"], trust: "high", competition: "medium", note: "Leading Swiss board." },
  { name: "InfoJobs", url: "https://www.infojobs.net/", regions: ["es", "it"], fields: ["all"], trust: "high", competition: "high", note: "Largest Spanish board." },
  { name: "Bayt", url: "https://www.bayt.com/", regions: ["ae", "ma", "tn"], fields: ["all"], trust: "high", competition: "high", note: "Biggest board for the Middle East and North Africa." },
  { name: "Rekrute", url: "https://www.rekrute.com/", regions: ["ma"], fields: ["all"], trust: "high", competition: "medium", note: "Leading Moroccan recruitment site." },
  { name: "Seek", url: "https://www.seek.com.au/", regions: ["au"], fields: ["all"], trust: "high", competition: "high", note: "Dominant board in Australia." },
];

export interface RankedSite extends JobSite {
  score: number;
  reasons: string[];
  /** The board's search page pre-filled with the user's keywords and filters, when supported. */
  searchUrl?: string;
}

const COMPETITION_POINTS: Record<Level, number> = { low: 3, medium: 1.5, high: 0 };
const TRUST_POINTS = { official: 2, high: 2, good: 1 };

export function rankJobSites(profile: Pick<Profile, "field" | "seniority"> | null, filters: Filters, limit = 10): RankedSite[] {
  const countryName = filters.country === "any" ? "" : (COUNTRIES.find((c) => c.code === filters.country)?.name ?? "");
  const query: BoardQuery = {
    keywords: filters.keywords.slice(0, 2).join(" "),
    country: filters.country,
    countryName,
    hours: filters.postedWithin && filters.postedWithin !== "any" ? POSTED_WITHIN_HOURS[filters.postedWithin] : undefined,
  };
  const wantsRemote = filters.workMode === "remote";
  const studentContract = filters.contract === "internship" || filters.contract === "apprenticeship";

  return JOB_SITES.flatMap((site): RankedSite[] => {
    const reasons: string[] = [];
    let score = 0;

    // Hard filters
    const local = filters.country !== "any" && site.regions.includes(filters.country);
    const global = site.regions.includes("global");
    if (!local && !global && filters.country !== "any") return [];
    if (site.remoteOnly && filters.workMode !== "any" && !wantsRemote) return [];
    if (site.contracts && filters.contract !== "any" && !site.contracts.includes(filters.contract)) return [];
    if (site.contracts?.includes("freelance") && site.contracts.length === 1 && filters.contract !== "freelance") return [];
    if (site.contracts?.every((c) => c === "internship" || c === "apprenticeship") && !studentContract && profile?.seniority !== "student") return [];

    if (local) { score += 3; reasons.push("Strong in your country"); }
    else if (filters.country === "any" && !global) score -= 4; // national board, but no country chosen
    if (wantsRemote && site.remoteOnly) { score += 3; reasons.push("Remote-only board"); }
    if (filters.contract !== "any" && site.contracts?.includes(filters.contract)) { score += 3; reasons.push("Specialised in this contract type"); }

    const field = profile?.field;
    if (field && site.fields.includes(field)) { score += 3; reasons.push("Specialised in your field"); }
    else if (site.fields.includes("all")) score += 1;
    else score -= 2; // niche board outside the candidate's field (or field unknown)

    score += COMPETITION_POINTS[site.competition] + TRUST_POINTS[site.trust];
    if (site.competition === "low") reasons.push("Low competition");
    if (site.trust === "official") reasons.push("Official / government source");

    const searchUrl = SEARCH[site.name]?.(query);
    return [{ ...site, score, reasons, searchUrl }];
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
