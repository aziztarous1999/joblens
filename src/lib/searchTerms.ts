// Turns the user's keywords into the job titles employers actually use, in English, French and
// German, so each job source is searched in its own language ("Full Stack Developer" also finds
// "Développeur Full Stack", "Ingénieur études et développement", "Fullstack-Entwickler").
//
// The AI (Gemini, or the local Ollama model as fallback) only suggests search terms; offers always
// come from the real job sources. If the AI is unavailable or slow, a small dictionary is used.

import * as z from "zod/v4";
import { getProvider } from "./ai";
import type { Profile } from "./types";

export interface SearchTerms {
  en: string[];
  fr: string[];
  de: string[];
  /** Where the terms came from, shown in the UI. */
  via: "ai" | "dictionary";
}

const MAX_PER_LANGUAGE = 4;
const AI_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 24 * 3600_000;

// ---------- Dictionary fallback ----------

// Common job-title words, English → [French, German]. Unknown words (React, Java…) stay unchanged.
const WORDS: Record<string, [string, string]> = {
  developer: ["développeur", "entwickler"],
  engineer: ["ingénieur", "ingenieur"],
  engineering: ["ingénierie", "engineering"],
  software: ["logiciel", "software"],
  "full-stack": ["fullstack", "fullstack"],
  fullstack: ["fullstack", "fullstack"],
  backend: ["back-end", "backend"],
  "back-end": ["back-end", "backend"],
  frontend: ["front-end", "frontend"],
  "front-end": ["front-end", "frontend"],
  data: ["data", "daten"],
  analyst: ["analyste", "analyst"],
  designer: ["designer", "designer"],
  manager: ["manager", "manager"],
  project: ["projet", "projekt"],
  product: ["produit", "produkt"],
  sales: ["commercial", "vertrieb"],
  accountant: ["comptable", "buchhalter"],
  accounting: ["comptabilité", "buchhaltung"],
  finance: ["finance", "finanzen"],
  consultant: ["consultant", "berater"],
  technician: ["technicien", "techniker"],
  administrator: ["administrateur", "administrator"],
  assistant: ["assistant", "assistent"],
  teacher: ["enseignant", "lehrer"],
  nurse: ["infirmier", "pflegekraft"],
  intern: ["stagiaire", "praktikant"],
  internship: ["stage", "praktikum"],
  apprentice: ["alternant", "auszubildender"],
  security: ["sécurité", "sicherheit"],
  network: ["réseau", "netzwerk"],
};
const GENERIC = new Set(["junior", "senior", "mid", "lead", "the", "and", "for", "with", "job", "jobs", "remote"]);

function translate(keyword: string, lang: 0 | 1): string {
  return keyword
    .toLowerCase()
    .split(/[\s,/()+]+/)
    .filter((w) => w.length >= 2 && !GENERIC.has(w))
    .map((w) => WORDS[w]?.[lang] ?? w)
    .join(" ");
}

const unique = (list: string[]) => {
  const seen = new Set<string>();
  return list.map((s) => s.trim()).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
};

export function dictionaryTerms(keywords: string[]): SearchTerms {
  return {
    en: unique(keywords).slice(0, MAX_PER_LANGUAGE),
    fr: unique(keywords.map((k) => translate(k, 0))).slice(0, MAX_PER_LANGUAGE),
    de: unique(keywords.map((k) => translate(k, 1))).slice(0, MAX_PER_LANGUAGE),
    via: "dictionary",
  };
}

// ---------- AI expansion ----------

const TermsSchema = z.object({
  en: z.array(z.string()).describe("English job titles"),
  fr: z.array(z.string()).describe("French job titles as written on French job boards"),
  de: z.array(z.string()).describe("German job titles as written on German job boards"),
});

const SYSTEM =
  "You help search job boards. For each language, give the 3 or 4 job titles most likely to appear in real job offers " +
  "matching the candidate's keywords, as employers write them on job boards in that country. " +
  "Rules: 1 to 4 words each; most common title first; keep the candidate's specialty (e.g. React, Java, data) when it is " +
  "part of the keyword; include one common local synonym (e.g. French 'Ingénieur études et développement'); " +
  "no seniority words (junior, senior) unless the keywords contain them; no gender markers like (H/F) or (m/w/d); " +
  "German: prefer German titles (e.g. 'Softwareentwickler', 'Fullstack-Entwickler'), plus at most one English title if German offers commonly use it. " +
  "Write each language with its correct spelling and accents (French 'Développeur', 'Ingénieur'; German umlauts). " +
  "No explanations, no duplicates.";

const cache = new Map<string, { terms: SearchTerms; at: number }>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/**
 * Search terms per language for these keywords. Uses the AI when available (cached 24h per
 * keyword set), otherwise the dictionary. Never throws: searching must keep working.
 */
export async function expandSearchTerms(keywords: string[], profile: Profile | null): Promise<SearchTerms> {
  const cleaned = unique(keywords);
  if (cleaned.length === 0) return { en: [], fr: [], de: [], via: "dictionary" };
  const key = `v2|${cleaned.map((k) => k.toLowerCase()).sort().join("|")}|${profile?.field ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.terms;

  const fallback = dictionaryTerms(cleaned);
  const provider = getProvider();
  if (provider.configError()) return fallback;

  try {
    const context = profile ? `\nCandidate: ${profile.headline}. Main skills: ${profile.skills.slice(0, 8).join(", ")}.` : "";
    const result = await withTimeout(
      provider.json({
        schema: TermsSchema,
        effort: "low",
        system: SYSTEM,
        input: { text: `Keywords: ${cleaned.join("; ")}${context}` },
      }),
      AI_TIMEOUT_MS,
    );
    // Keep the user's own keywords first for English sources, then the AI's suggestions.
    const clean = (list: string[]) => list.map((s) => s.replace(/\((h\/f|f\/h|m\/w\/d|w\/m\/d|m\/f)\)/gi, "").trim()).filter((s) => s.length >= 2);
    const terms: SearchTerms = {
      en: unique([...cleaned.slice(0, 2), ...clean(result.en)]).slice(0, MAX_PER_LANGUAGE),
      fr: unique(clean(result.fr)).slice(0, MAX_PER_LANGUAGE),
      de: unique(clean(result.de)).slice(0, MAX_PER_LANGUAGE),
      via: "ai",
    };
    if (!terms.fr.length) terms.fr = fallback.fr;
    if (!terms.de.length) terms.de = fallback.de;
    cache.set(key, { terms, at: Date.now() });
    return terms;
  } catch (error) {
    console.warn("search-term expansion failed, using dictionary:", error instanceof Error ? error.message : error);
    return fallback;
  }
}

/** Main language of a country's job boards. */
export function languageOf(countryCode: string | undefined): "en" | "fr" | "de" {
  if (countryCode && ["fr", "be", "ma", "tn"].includes(countryCode)) return "fr";
  if (countryCode && ["de", "at", "ch"].includes(countryCode)) return "de";
  return "en";
}
