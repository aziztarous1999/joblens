// Picks the AI provider from AI_PROVIDER (gemini | claude | ollama).
// Without it: Gemini if GEMINI_API_KEY is set, else Claude if ANTHROPIC_API_KEY is set, else Gemini.
// AI_FALLBACK=ollama makes the local model take over whenever the main provider is
// overloaded, rate-limited or out of free quota.

import type { OutputLanguage } from "../types";
import { claude } from "./claude";
import { gemini } from "./gemini";
import { ollamaProvider } from "./ollama";
import { AiError, type AiProvider } from "./types";

export { AiError } from "./types";

function mainProvider(): AiProvider {
  const choice = process.env.AI_PROVIDER?.toLowerCase();
  if (choice === "ollama") return ollamaProvider;
  if (choice === "claude") return claude;
  if (choice === "gemini") return gemini;
  if (!process.env.GEMINI_API_KEY && process.env.ANTHROPIC_API_KEY) return claude;
  return gemini;
}

// Overloaded (503), rate limit / quota (429), timeout (504): worth handing to the backup.
const handOff = (error: unknown) => error instanceof AiError && [429, 503, 504].includes(error.status);

/** Wraps `primary` so calls go to `backup` when the primary is unavailable. */
function withBackup(primary: AiProvider, backup: AiProvider): AiProvider {
  return {
    name: primary.name,
    local: primary.local,
    configError: () => null,
    async json(opts) {
      if (primary.configError()) return backup.json(opts);
      try {
        return await primary.json(opts);
      } catch (error) {
        if (!handOff(error)) throw error;
        console.warn(`${primary.name} unavailable, using ${backup.name}`);
        return backup.json(opts);
      }
    },
    async *stream(opts) {
      if (primary.configError()) return yield* backup.stream(opts);
      let started = false;
      try {
        for await (const chunk of primary.stream(opts)) {
          started = true;
          yield chunk;
        }
      } catch (error) {
        // Only switch before any text was sent; mid-stream errors are reported as they are.
        if (started || !handOff(error)) throw error;
        console.warn(`${primary.name} unavailable, using ${backup.name}`);
        yield* backup.stream(opts);
      }
    },
    async research(opts) {
      if (primary.configError()) return backup.research(opts);
      try {
        return await primary.research(opts);
      } catch (error) {
        if (!handOff(error)) throw error;
        return backup.research(opts);
      }
    },
  };
}

export function getProvider(): AiProvider {
  const main = mainProvider();
  const useBackup = process.env.AI_FALLBACK?.toLowerCase() === "ollama" && main !== ollamaProvider;
  return useBackup ? withBackup(main, ollamaProvider) : main;
}

/** Returns the provider, or throws an AiError explaining what to configure. */
export function requireProvider(): AiProvider {
  const provider = getProvider();
  const problem = provider.configError();
  if (problem) throw new AiError(problem, 401);
  return provider;
}

const LANGUAGE_NAMES: Record<Exclude<OutputLanguage, "auto">, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
};

export function languageInstruction(lang: OutputLanguage): string {
  return lang === "auto" ? "Write in the same language as the job offer." : `Write in ${LANGUAGE_NAMES[lang]}.`;
}

/** Turns any error into a JSON response for the UI. */
export function errorResponse(error: unknown): Response {
  if (error instanceof AiError) return Response.json({ error: error.message }, { status: error.status });
  console.error(error);
  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ error: message }, { status: 500 });
}
