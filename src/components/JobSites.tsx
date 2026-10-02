"use client";

import type { RankedSite } from "@/lib/jobSites";
import { Badge, Card } from "./ui";

const COMPETITION_TONE = { low: "good", medium: "warn", high: "bad" } as const;
const TRUST_LABEL = { official: "Official", high: "Highly trusted", good: "Trusted" };

export function JobSites({ sites }: { sites: RankedSite[] }) {
  return (
    // Not collapsible: the whole panel is hidden from the ☰ button in the header instead.
    <Card title="Best job boards for you" collapsible={false}>
      <p className="-mt-2 mb-3 text-sm text-muted">
        Ranked for your field and filters. “Search” opens each site with your keywords already filled in. Competition levels are estimates: niche and official boards usually get fewer applicants than the big ones.
      </p>
      {sites.length === 0 && <p className="text-sm text-muted">No board matches these filters. Try “Any” for work mode or contract type.</p>}
      <ol className="space-y-3">
        {sites.map((s, i) => (
          <li key={s.name} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-muted">#{i + 1}</span>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">
                {s.name} ↗
              </a>
              <Badge tone={s.trust === "official" ? "accent" : "neutral"}>{TRUST_LABEL[s.trust]}</Badge>
              <Badge tone={COMPETITION_TONE[s.competition]}>{s.competition} competition</Badge>
            </div>
            <p className="mt-1 text-sm">{s.note}</p>
            {s.reasons.length > 0 && <p className="mt-1 text-xs text-muted">{s.reasons.join(" · ")}</p>}
            {s.searchUrl && (
              <a
                href={s.searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-lg border border-accent px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10"
              >
                Search your keywords here ↗
              </a>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
