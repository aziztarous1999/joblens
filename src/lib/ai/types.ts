import type * as z from "zod/v4";
import type { CvUpload, Source } from "../types";

/** A prompt, optionally with the uploaded CV attached before it. */
export interface AiInput {
  cv?: CvUpload;
  text: string;
}

export interface ResearchResult {
  markdown: string;
  /** Pages the answer is grounded on. */
  sources: Source[];
  /** Other pages the search looked at. */
  other: Source[];
}

/** Everything the app needs from an AI model. Implemented for Gemini, Claude and Ollama. */
export interface AiProvider {
  name: "gemini" | "claude" | "ollama";
  /** Runs on this computer (slower, smaller context): callers send smaller batches. */
  local?: boolean;
  /** Missing key or other config problem, or null when ready. */
  configError(): string | null;
  /** Returns data matching `schema` (structured output). */
  json<S extends z.ZodType>(opts: { system?: string; input: AiInput; schema: S; effort: "low" | "medium" }): Promise<z.infer<S>>;
  /** Streams Markdown text. */
  stream(opts: { system: string; prompt: string }): AsyncIterable<string>;
  /** Answers with live web search and returns the sources. */
  research(opts: { system: string; prompt: string; country?: string; queries: string[]; fallbackLinks: Source[] }): Promise<ResearchResult>;
}

/** Error with a message that is safe and useful to show in the UI. */
export class AiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
