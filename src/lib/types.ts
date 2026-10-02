// Shared types used by both the API routes and the UI.

export type WorkMode = "any" | "remote" | "hybrid" | "onsite";
export type ContractType =
  | "any"
  | "permanent"
  | "fixed_term"
  | "freelance"
  | "internship"
  | "apprenticeship";
export type Schedule = "any" | "full_time" | "part_time";
export type PostedWithin = "any" | "1h" | "2h" | "6h" | "1d" | "3d";

export const POSTED_WITHIN_HOURS: Record<Exclude<PostedWithin, "any">, number> = {
  "1h": 1,
  "2h": 2,
  "6h": 6,
  "1d": 24,
  "3d": 72,
};
export type JobSource =
  | "remotive"
  | "arbeitnow"
  | "adzuna"
  | "himalayas"
  | "jobicy"
  | "jsearch"
  | "francetravail"
  | "bundesagentur"
  | "manual";
export type OutputLanguage = "auto" | "en" | "fr" | "de" | "es";

/** The CV as uploaded by the user, before the AI has read it. */
export type CvUpload =
  | { kind: "pdf"; name: string; base64: string }
  | { kind: "text"; name: string; text: string };

export const FIELDS = [
  "software",
  "data_ai",
  "design",
  "marketing",
  "sales",
  "finance",
  "engineering",
  "healthcare",
  "education",
  "hospitality",
  "operations",
  "other",
] as const;
export type Field = (typeof FIELDS)[number];

/** What the AI extracts from the CV. */
export interface Profile {
  full_name: string;
  headline: string;
  seniority: "student" | "junior" | "mid" | "senior" | "lead";
  years_experience: number;
  field: Field;
  location: string;
  languages: string[];
  skills: string[];
  search_keywords: string[];
  summary: string;
  /** Full CV transcribed to Markdown, reused by every later call. */
  cv_markdown: string;
}

export interface Filters {
  keywords: string[];
  /** ISO 3166-1 alpha-2, lowercase, or "any". */
  country: string;
  workMode: WorkMode;
  contract: ContractType;
  schedule: Schedule;
  postedWithin: PostedWithin;
  /** Only offers that mention relocation help or visa sponsorship. */
  relocation?: boolean;
  sources: JobSource[];
}

export interface Job {
  id: string;
  source: JobSource;
  title: string;
  company: string;
  location: string;
  workMode: Exclude<WorkMode, "any"> | "unknown";
  contract: string;
  salary?: string;
  url: string;
  postedAt?: string;
  /**
   * "posted": the board's own publication date. "seen": when an aggregator (Google for Jobs via
   * JSearch, Adzuna) found or re-indexed the offer; the real posting date may be much older.
   */
  dateKind?: "posted" | "seen";
  description: string;
  /** Mentions relocation help or visa sponsorship. */
  relocation?: boolean;
  /** Original site for aggregated offers, e.g. "LinkedIn" or "Indeed" (JSearch). */
  publisher?: string;
}

/** An offer removed by the fake/spam filter, shown to the user with the reason. */
export interface HiddenOffer {
  title: string;
  company: string;
  url: string;
  reason: string;
}

export interface Match {
  id: string;
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
}

export interface Source {
  title: string;
  url: string;
}
