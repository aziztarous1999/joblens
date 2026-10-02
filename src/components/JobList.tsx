"use client";

import { useMemo, useState } from "react";
import type { SearchTerms } from "@/lib/searchTerms";
import type { HiddenOffer, Job, Match } from "@/lib/types";
import { Badge, Button, Card } from "./ui";

const SOURCE_LABEL: Record<Job["source"], string> = {
  remotive: "Remotive",
  arbeitnow: "Arbeitnow",
  adzuna: "Adzuna",
  himalayas: "Himalayas",
  jobicy: "Jobicy",
  jsearch: "JSearch",
  francetravail: "France Travail",
  bundesagentur: "Bundesagentur für Arbeit",
  manual: "Added by you",
};

const PAGE_SIZE = 15;
type Sort = "match" | "newest";

const time = (iso?: string) => (iso ? Date.parse(iso) : NaN);

function timeAgo(iso?: string): string | null {
  const ms = Date.now() - time(iso);
  if (Number.isNaN(ms)) return null;
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** e.g. "2 Oct 2026, 16:30 · 2h ago" in the viewer's locale and timezone. */
function postedLabel(iso?: string): string | null {
  const t = time(iso);
  if (Number.isNaN(t)) return null;
  const date = new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${date} · ${timeAgo(iso)}`;
}

function scoreTone(score: number) {
  if (score >= 80) return "text-good border-good";
  if (score >= 60) return "text-warn border-warn";
  return "text-bad border-bad";
}

function JobCard({ job, match, selected, onSelect }: { job: Job; match?: Match; selected: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`rounded-xl border p-4 transition ${selected ? "border-accent ring-2 ring-accent/30" : "border-line"}`}>
      <div className="flex gap-4">
        {match ? (
          <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-full border-4 text-base font-bold ${scoreTone(match.score)}`}>
            {Math.round(match.score)}
          </div>
        ) : (
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-4 border-line text-xs text-muted">n/a</div>
        )}
        <div className="min-w-0 flex-1">
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-accent hover:underline">
            {job.title}
          </a>
          <p className="text-sm text-muted">
            {job.company} · {job.location}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {job.workMode !== "unknown" && <Badge tone="accent">{job.workMode}</Badge>}
            {job.contract && <Badge>{job.contract}</Badge>}
            {job.salary && <Badge tone="good">{job.salary}</Badge>}
            {job.relocation && <Badge tone="good">✈️ Relocation / visa support</Badge>}
            {postedLabel(job.postedAt) &&
              (job.dateKind === "seen" ? (
                <span title="This source only knows when the offer was last indexed. The real posting date may be much older: check the offer page.">
                  <Badge tone="warn">👁 Found {timeAgo(job.postedAt)} · real posting date unknown</Badge>
                </span>
              ) : (
                <Badge>🕒 Posted {postedLabel(job.postedAt)}</Badge>
              ))}
            <Badge>via {job.publisher ? (job.source === "jsearch" ? `${job.publisher} (JSearch)` : job.publisher) : SOURCE_LABEL[job.source]}</Badge>
          </div>
          {match && (
            <div className="mt-2 text-sm">
              <p>{match.verdict}</p>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {match.strengths.length > 0 && <p className="text-good">✓ {match.strengths.join(" · ")}</p>}
                {match.gaps.length > 0 && <p className="text-warn">△ {match.gaps.join(" · ")}</p>}
              </div>
            </div>
          )}
          {open && <p className="mt-2 max-h-60 overflow-auto whitespace-pre-line rounded-lg bg-subtle p-3 text-xs">{job.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={onSelect}>{selected ? "Selected ✓" : "Prepare application"}</Button>
            {job.url && job.url !== "#" && (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/10"
              >
                View offer ↗
              </a>
            )}
            <Button variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide description" : "Description"}</Button>
          </div>
        </div>
      </div>
    </li>
  );
}

export function ManualJobForm({ onAdd }: { onAdd: (job: Job) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", company: "", location: "", url: "", description: "" });
  const field = (key: keyof typeof form, placeholder: string) => (
    <input
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      placeholder={placeholder}
      className="rounded-lg border border-line bg-background px-3 py-2 text-sm"
    />
  );

  if (!open) {
    return <Button variant="ghost" onClick={() => setOpen(true)}>+ Paste an offer (LinkedIn, Welcome to the Jungle…)</Button>;
  }
  return (
    <div className="w-full rounded-xl border border-line p-4">
      <p className="mb-2 text-sm font-medium">Paste an offer you found elsewhere</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {field("title", "Job title *")}
        {field("company", "Company *")}
        {field("location", "Location (city, country)")}
        {field("url", "Link to the offer (optional)")}
      </div>
      <textarea
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        placeholder="Paste the full job description *"
        className="mt-2 min-h-32 w-full rounded-lg border border-line bg-background p-3 text-sm"
      />
      <div className="mt-2 flex gap-2">
        <Button
          disabled={!form.title || !form.company || form.description.length < 50}
          onClick={() => {
            const text = `${form.title} ${form.description}`;
            onAdd({
              id: `manual-${Date.now()}`,
              source: "manual",
              title: form.title,
              company: form.company,
              location: form.location,
              workMode: /hybrid|hybride/i.test(text) ? "hybrid" : /remote|télétravail/i.test(text) ? "remote" : "unknown",
              contract: "",
              url: form.url || "#",
              description: form.description,
            });
            setForm({ title: "", company: "", location: "", url: "", description: "" });
            setOpen(false);
          }}
        >
          Add offer
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export function JobList({
  jobs,
  matches,
  selectedId,
  onSelect,
  onAdd,
  total,
  warnings,
  dateInfo,
  hidden,
  searchTerms,
}: {
  jobs: Job[];
  matches: Map<string, Match>;
  selectedId: string | null;
  onSelect: (job: Job) => void;
  onAdd: (job: Job) => void;
  total: number | null;
  warnings: string[];
  /** Set when a date filter is active, to explain empty results. */
  dateInfo?: { label: string; beforeDateFilter: number; newestPostedAt?: string };
  hidden: HiddenOffer[];
  searchTerms: SearchTerms | null;
}) {
  const [sort, setSort] = useState<Sort>("match");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (sort === "match") return jobs; // server order: AI score, then local relevance
    // Real posting dates first; "found x days ago" dates (unknown real age) after them.
    const t = (j: Job) => (Number.isNaN(time(j.postedAt)) ? 0 : time(j.postedAt));
    const verified = (j: Job) => (j.dateKind === "seen" ? 0 : 1);
    return [...jobs].sort((a, b) => verified(b) - verified(a) || t(b) - t(a));
  }, [jobs, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const goTo = (p: number) => {
    setPage(p);
    document.getElementById("offers")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div id="offers">
      <Card
        title="Best offers for your CV"
        step={3}
        aside={
          total !== null && (
            <span className="text-sm text-muted">
              {total} found · {matches.size} scored by AI
            </span>
          )
        }
      >
        {warnings.map((w) => (
          <p key={w} className="mb-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{w}</p>
        ))}
        {searchTerms && searchTerms.en.length + searchTerms.fr.length + searchTerms.de.length > 0 && (
          <details className="mb-3 text-xs text-muted">
            <summary className="cursor-pointer">
              🔎 Searched in each source&apos;s language{searchTerms.via === "ai" ? " (titles suggested by AI)" : ""}
            </summary>
            <div className="mt-1 space-y-0.5 pl-4">
              {(["en", "fr", "de"] as const).map((lang) =>
                searchTerms[lang].length ? (
                  <p key={lang}>
                    <span className="font-medium uppercase">{lang}</span>: {searchTerms[lang].join(" · ")}
                  </p>
                ) : null,
              )}
            </div>
          </details>
        )}
        {hidden.length > 0 && (
          <details className="mb-3 rounded-lg bg-subtle px-3 py-2 text-sm">
            <summary className="cursor-pointer">
              🛡️ {hidden.length} offer{hidden.length > 1 ? "s" : ""} hidden as likely fake or spam
            </summary>
            <ul className="mt-2 space-y-1 text-xs">
              {hidden.map((h) => (
                <li key={`${h.url}-${h.title}`}>
                  <a href={h.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{h.title}</a>
                  <span className="text-muted"> · {h.company || "no company"} · {h.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <ManualJobForm onAdd={onAdd} />
          {jobs.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">Sort by</span>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as Sort);
                  setPage(0);
                }}
                className="rounded-lg border border-line bg-background px-2 py-1.5"
              >
                <option value="match">Best match (AI score)</option>
                <option value="newest">Newest first</option>
              </select>
            </label>
          )}
        </div>

        {jobs.length === 0 ? (
          <p className="text-sm text-muted">
            {total === null
              ? "Run a search, or paste an offer you found elsewhere."
              : dateInfo && dateInfo.beforeDateFilter > 0
                ? `No offers posted in the ${dateInfo.label}. ${dateInfo.beforeDateFilter} offers match your other filters` +
                  (dateInfo.newestPostedAt ? `; the newest was posted ${timeAgo(dateInfo.newestPostedAt)}.` : ".") +
                  " Try a longer period."
                : "No offers matched. Try broader keywords, another country, or set work mode to “Any”."}
          </p>
        ) : (
          <>
            <ul className="space-y-3">
              {visible.map((job) => (
                <JobCard key={job.id} job={job} match={matches.get(job.id)} selected={job.id === selectedId} onSelect={() => onSelect(job)} />
              ))}
            </ul>
            {pages > 1 && (
              <nav className="mt-4 flex flex-wrap items-center justify-center gap-1.5" aria-label="Offer pages">
                <Button variant="ghost" disabled={current === 0} onClick={() => goTo(current - 1)}>‹ Prev</Button>
                {Array.from({ length: pages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    aria-current={i === current ? "page" : undefined}
                    className={`h-9 min-w-9 rounded-lg px-2 text-sm font-medium ${i === current ? "bg-accent text-white" : "hover:bg-subtle"}`}
                  >
                    {i + 1}
                  </button>
                ))}
                <Button variant="ghost" disabled={current === pages - 1} onClick={() => goTo(current + 1)}>Next ›</Button>
                <span className="ml-2 text-xs text-muted">
                  {current * PAGE_SIZE + 1}–{Math.min((current + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
                </span>
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
