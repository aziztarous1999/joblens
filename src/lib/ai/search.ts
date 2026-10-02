// Web search for providers without a free built-in search tool (Gemini's free tier has none).
// Tavily: free plan, no credit card, key at https://app.tavily.com

import { countryByCode } from "../countries";
import type { Source } from "../types";
import { AiError } from "./types";

export interface SearchHit extends Source {
  content: string;
}

export const searchConfigured = () => Boolean(process.env.TAVILY_API_KEY);

interface TavilyResponse {
  results: { title: string; url: string; content: string }[];
}

async function tavily(query: string, country?: string): Promise<SearchHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 5, ...(country ? { country } : {}) }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = (await res.json()) as TavilyResponse;
  return data.results.map((r) => ({ title: r.title, url: r.url, content: r.content }));
}

/** Runs all queries in parallel and returns de-duplicated hits. Failed queries are skipped. */
export async function webSearch(queries: string[], country?: string): Promise<SearchHit[]> {
  const settled = await Promise.allSettled(queries.map((q) => tavily(q, country)));
  const seen = new Map<string, SearchHit>();
  for (const r of settled) {
    if (r.status === "fulfilled") for (const hit of r.value) if (!seen.has(hit.url)) seen.set(hit.url, hit);
  }
  return [...seen.values()];
}

/**
 * Research for providers without a built-in search tool (Gemini free tier, Ollama):
 * searches the web with Tavily, then has the model answer from those results with [n] citations.
 * Without a Tavily key, returns a clearly labelled estimate plus links to verify it.
 */
export async function groundedResearch(
  opts: { prompt: string; country?: string; queries: string[]; fallbackLinks: Source[] },
  generate: (prompt: string) => Promise<string>,
): Promise<{ markdown: string; sources: Source[]; other: Source[] }> {
  const { prompt, country, queries, fallbackLinks } = opts;
  if (!searchConfigured()) {
    const text = await generate(
      `${prompt}\n\nYou have no web access for this answer: give your best estimate from what you know. ` +
        "Do not attribute any figure to a named website or study (you have not checked them): in the salary table, " +
        "replace the Source column with 'Level' (e.g. entry, typical, experienced). Do not write any URLs or [n] citations.",
    );
    const note =
      "> ⚠️ Live search is off (add a free `TAVILY_API_KEY` to `.env.local`). These figures are an AI estimate. Check them on the links below.\n\n";
    return { markdown: note + text, sources: [], other: fallbackLinks };
  }

  const hits = await webSearch(queries, country && country !== "any" ? countryByCode(country)?.name.toLowerCase() : undefined);
  if (hits.length === 0) throw new AiError("Web search returned nothing. Check TAVILY_API_KEY or retry.", 502);

  const context = hits
    .map((h, i) => `<source n="${i + 1}" title="${h.title}" url="${h.url}">\n${h.content}\n</source>`)
    .join("\n");
  const markdown = await generate(
    `<search_results>\n${context}\n</search_results>\n\n${prompt}\n\n` +
      "Use only the search results above for figures. After each figure cite its source number in square brackets, e.g. [2]. " +
      "If the results do not cover something, say so instead of guessing.",
  );

  // Sources the answer actually cites, in citation order; the rest go to "other pages consulted".
  const cited = [...new Set([...markdown.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]) - 1))].filter((i) => hits[i]);
  const sources = cited.map((i) => ({ title: `[${i + 1}] ${hits[i].title}`, url: hits[i].url }));
  const other = hits.filter((_, i) => !cited.includes(i)).map(({ title, url }) => ({ title, url }));
  return { markdown, sources, other: other.slice(0, 8) };
}
