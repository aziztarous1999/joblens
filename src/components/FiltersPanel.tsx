"use client";

import { useState } from "react";
import { COUNTRIES } from "@/lib/countries";
import type { ContractType, Filters, JobSource, PostedWithin, Schedule, WorkMode } from "@/lib/types";
import { Button, Card, Select, Spinner } from "./ui";

const SOURCES: { value: JobSource; label: string; hint: string }[] = [
  { value: "remotive", label: "Remotive", hint: "remote jobs worldwide" },
  { value: "arbeitnow", label: "Arbeitnow", hint: "Germany, on-site & remote" },
  { value: "francetravail", label: "France Travail", hint: "all of France, official, free key, no monthly limit" },
  { value: "bundesagentur", label: "Bundesagentur für Arbeit", hint: "all of Germany, official, no key" },
  { value: "adzuna", label: "Adzuna", hint: "on-site & hybrid in 16 countries, free API key" },
  { value: "himalayas", label: "Himalayas", hint: "remote, updated every few minutes" },
  { value: "jobicy", label: "Jobicy", hint: "remote, filterable by country" },
  { value: "jsearch", label: "LinkedIn / Indeed / Glassdoor", hint: "via JSearch, free RapidAPI key, ~100 searches/month" },
];

export function FiltersPanel({
  filters,
  onChange,
  onSearch,
  loading,
  disabled,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onSearch: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });

  function addKeyword() {
    const k = draft.trim();
    if (k && !filters.keywords.includes(k)) set("keywords", [...filters.keywords, k]);
    setDraft("");
  }

  return (
    <Card title="What are you looking for?" step={2}>
      <div className="mb-4">
        <span className="text-sm font-medium text-muted">Search keywords</span>
        <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-background p-2">
          {filters.keywords.map((k) => (
            <span key={k} className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-sm text-accent">
              {k}
              <button aria-label={`Remove ${k}`} onClick={() => set("keywords", filters.keywords.filter((x) => x !== k))}>×</button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
            onBlur={addKeyword}
            placeholder="Add a keyword + Enter"
            className="min-w-40 flex-1 bg-transparent px-1 text-sm outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          label="Country"
          value={filters.country}
          onChange={(v) => set("country", v)}
          options={[{ value: "any", label: "Any country" }, ...COUNTRIES.map((c) => ({ value: c.code, label: c.name }))]}
        />
        <Select<WorkMode>
          label="Work mode"
          value={filters.workMode}
          onChange={(v) => set("workMode", v)}
          options={[
            { value: "any", label: "Any (on-site, hybrid, remote)" },
            { value: "onsite", label: "On-site" },
            { value: "hybrid", label: "Hybrid" },
            { value: "remote", label: "Remote only" },
          ]}
        />
        <Select<ContractType>
          label="Contract type"
          value={filters.contract}
          onChange={(v) => set("contract", v)}
          options={[
            { value: "any", label: "Any" },
            { value: "permanent", label: "Permanent (CDI)" },
            { value: "fixed_term", label: "Fixed-term (CDD)" },
            { value: "freelance", label: "Freelance / contract" },
            { value: "internship", label: "Internship (stage)" },
            { value: "apprenticeship", label: "Apprenticeship (alternance)" },
          ]}
        />
        <Select<Schedule>
          label="Schedule"
          value={filters.schedule}
          onChange={(v) => set("schedule", v)}
          options={[
            { value: "any", label: "Any" },
            { value: "full_time", label: "Full-time" },
            { value: "part_time", label: "Part-time" },
          ]}
        />
        <Select<PostedWithin>
          label="Posted"
          value={filters.postedWithin ?? "any"}
          onChange={(v) => set("postedWithin", v)}
          options={[
            { value: "any", label: "Any time" },
            { value: "1h", label: "Last hour" },
            { value: "2h", label: "Last 2 hours" },
            { value: "6h", label: "Last 6 hours" },
            { value: "1d", label: "Last 24 hours" },
            { value: "3d", label: "Last 3 days" },
          ]}
        />
      </div>
      {filters.postedWithin && filters.postedWithin !== "any" && filters.sources.includes("remotive") && (
        <p className="mt-2 text-xs text-muted">
          Note: Remotive publishes offers with a 24-hour delay, so very recent filters mostly show Arbeitnow and Adzuna offers.
        </p>
      )}

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!filters.relocation} onChange={(e) => set("relocation", e.target.checked)} />
        <span>
          ✈️ Only offers with <strong>relocation or visa support</strong>
          <span className="text-muted"> (set country to “Any” to search abroad)</span>
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <span className="font-medium text-muted">Job sources:</span>
        {SOURCES.map((s) => (
          <label key={s.value} className="flex items-center gap-1.5" title={s.hint}>
            <input
              type="checkbox"
              checked={filters.sources.includes(s.value)}
              onChange={(e) =>
                set("sources", e.target.checked ? [...filters.sources, s.value] : filters.sources.filter((x) => x !== s.value))
              }
            />
            {s.label} <span className="text-muted">({s.hint})</span>
          </label>
        ))}
      </div>

      <div className="mt-5">
        <Button onClick={onSearch} disabled={disabled || loading || filters.sources.length === 0}>
          {loading && <Spinner />} {loading ? "Searching and scoring offers…" : "Find my best matches"}
        </Button>
      </div>
    </Card>
  );
}
