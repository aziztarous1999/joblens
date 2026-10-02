"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CvStep } from "@/components/CvStep";
import { FiltersPanel } from "@/components/FiltersPanel";
import { JobList } from "@/components/JobList";
import { JobSites } from "@/components/JobSites";
import { ErrorNote } from "@/components/ui";
import { Workspace } from "@/components/Workspace";
import { postJson, readStorage, writeStorage } from "@/lib/client";
import { rankJobSites } from "@/lib/jobSites";
import type { SearchTerms } from "@/lib/searchTerms";
import type { Filters, HiddenOffer, Job, Match, Profile } from "@/lib/types";

const DEFAULT_FILTERS: Filters = {
  keywords: [],
  country: "any",
  workMode: "any",
  contract: "any",
  schedule: "any",
  postedWithin: "any",
  sources: ["francetravail", "bundesagentur", "adzuna", "remotive", "arbeitnow", "himalayas", "jobicy", "jsearch"],
};

const noopSubscribe = () => () => {};

export default function Home() {
  // Render only in the browser so saved state (localStorage) can seed the initial state.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return hydrated ? <App /> : null;
}

function App() {
  // The analysed CV and filters are remembered between visits (this browser only).
  const [profile, setProfile] = useState<Profile | null>(() => readStorage<Profile>("cvjm.profile"));
  const [filters, setFilters] = useState<Filters>(() => loadFilters(readStorage<Profile>("cvjm.profile")));
  const [jobs, setJobs] = useState<Job[]>([]);
  const [matches, setMatches] = useState<Map<string, Match>>(new Map());
  const [total, setTotal] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dateInfo, setDateInfo] = useState<{ label: string; beforeDateFilter: number; newestPostedAt?: string }>();
  const [searchId, setSearchId] = useState(0);
  const [hidden, setHidden] = useState<HiddenOffer[]>([]);
  // Key-based sources the server can use (e.g. no JSearch key on the public demo).
  const [available, setAvailable] = useState<Partial<Record<Filters["sources"][number], boolean>>>({});
  const [searchTerms, setSearchTerms] = useState<SearchTerms | null>(null);
  // Right-hand "Best job boards" panel: can be hidden to give the main column the full width.
  const [showBoards, setShowBoards] = useState<boolean>(() => readStorage<boolean>("cvjm.showBoards") ?? true);
  const [selected, setSelected] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => writeStorage(FILTERS_KEY, filters), [filters]);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d: { available?: typeof available }) => setAvailable(d.available ?? {}))
      .catch(() => {});
  }, []);
  useEffect(() => writeStorage("cvjm.showBoards", showBoards), [showBoards]);

  function handleProfile(p: Profile | null) {
    setProfile(p);
    writeStorage("cvjm.profile", p);
    if (p) {
      const loc = p.location.toLowerCase();
      setFilters((f) => ({ ...f, keywords: p.search_keywords.slice(0, 4), country: f.country !== "any" ? f.country : guessCountry(loc) }));
    }
  }

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const res = await postJson<{
        jobs: Job[];
        matches: Match[];
        warnings: string[];
        total: number;
        beforeDateFilter: number;
        newestPostedAt?: string;
        hidden: HiddenOffer[];
        searchTerms?: SearchTerms;
      }>("/api/jobs", {
        filters: { ...filters, sources: filters.sources.filter((s) => available[s] !== false) },
        profile,
      });
      const manual = jobs.filter((j) => j.source === "manual");
      setJobs([...manual, ...res.jobs]);
      setMatches(new Map(res.matches.map((m) => [m.id, m])));
      setWarnings(res.warnings);
      setTotal(res.total);
      setHidden(res.hidden ?? []);
      setSearchTerms(res.searchTerms ?? null);
      setDateInfo(
        filters.postedWithin !== "any"
          ? { label: POSTED_LABELS[filters.postedWithin], beforeDateFilter: res.beforeDateFilter, newestPostedAt: res.newestPostedAt }
          : undefined,
      );
      setSearchId((n) => n + 1); // resets sorting and pagination
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function select(job: Job) {
    setSelected(job);
    setTimeout(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  const sites = useMemo(() => rankJobSites(profile, filters), [profile, filters]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, no optimisation needed */}
            <img src="/icon.svg" alt="" width={40} height={40} className="rounded-xl" />
            JobLens
          </h1>
          <button
            type="button"
            onClick={() => setShowBoards(!showBoards)}
            aria-expanded={showBoards}
            aria-controls="job-boards-panel"
            title={showBoards ? "Hide the job boards panel" : "Show the job boards panel"}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              showBoards ? "border-accent bg-accent/10 text-accent" : "border-line hover:bg-subtle"
            }`}
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Job boards</span>
          </button>
        </div>
        <p className="mt-1 text-muted">
          Upload your CV, find the offers that fit you best, then generate a cover letter, a tailored CV, answers to application questions and a sourced salary estimate.
        </p>
      </header>

      <div className={`grid gap-6 ${showBoards ? "lg:grid-cols-[1fr_22rem]" : ""}`}>
        <div className="space-y-6">
          <CvStep profile={profile} onProfile={handleProfile} />
          <FiltersPanel filters={filters} onChange={setFilters} onSearch={search} loading={loading} disabled={!profile} available={available} />
          <ErrorNote message={error} />
          <JobList
            key={searchId}
            jobs={jobs}
            matches={matches}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onAdd={(job) => { setJobs((j) => [job, ...j]); select(job); }}
            total={total}
            warnings={warnings}
            dateInfo={dateInfo}
            hidden={hidden}
            searchTerms={searchTerms}
          />
          <div ref={workspaceRef}>
            {selected && profile && <Workspace key={selected.id} job={selected} profile={profile} country={filters.country} />}
            {selected && !profile && <p className="text-sm text-muted">Analyse your CV first to generate documents.</p>}
          </div>
        </div>
        {showBoards && (
          <aside id="job-boards-panel" className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
            <JobSites sites={sites} />
          </aside>
        )}
      </div>

      <footer className="mt-10 text-center text-xs text-muted">
        Offers from France Travail, Bundesagentur für Arbeit, Adzuna, Remotive, Arbeitnow, Himalayas, Jobicy and JSearch (LinkedIn, Indeed, Glassdoor…) (each links to its original post). AI by Gemini, a local Ollama model or Claude. Always check generated documents before sending them.
      </footer>
    </main>
  );
}

// Bumped when sources are added (v4: France Travail, Bundesagentur), so older saved filters do not leave new ones off.
const FILTERS_KEY = "cvjm.filters.v4";

function loadFilters(profile: Profile | null): Filters {
  const saved = readStorage<Filters>(FILTERS_KEY);
  if (saved) return { ...DEFAULT_FILTERS, ...saved };
  const old = readStorage<Filters>("cvjm.filters.v3") ?? readStorage<Filters>("cvjm.filters.v2") ?? readStorage<Filters>("cvjm.filters");
  if (old) return { ...DEFAULT_FILTERS, ...old, sources: DEFAULT_FILTERS.sources };
  return profile ? { ...DEFAULT_FILTERS, keywords: profile.search_keywords.slice(0, 4) } : DEFAULT_FILTERS;
}

const POSTED_LABELS: Record<Exclude<Filters["postedWithin"], "any">, string> = {
  "1h": "last hour",
  "2h": "last 2 hours",
  "6h": "last 6 hours",
  "1d": "last 24 hours",
  "3d": "last 3 days",
};

function guessCountry(location: string): string {
  const map: [RegExp, string][] = [
    [/france|paris|lyon|marseille|toulouse|lille|bordeaux|nantes/, "fr"],
    [/germany|deutschland|berlin|munich|münchen|hamburg/, "de"],
    [/united kingdom|\buk\b|london|england/, "gb"],
    [/morocco|maroc|casablanca|rabat/, "ma"],
    [/tunisia|tunisie|tunis/, "tn"],
    [/spain|españa|madrid|barcelona/, "es"],
    [/canada|montr[ée]al|toronto/, "ca"],
    [/united states|usa|new york|san francisco/, "us"],
  ];
  return map.find(([re]) => re.test(location))?.[1] ?? "any";
}
