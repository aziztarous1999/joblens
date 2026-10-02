// Google Gemini provider. The free tier needs only a key from https://aistudio.google.com/apikey
// (no credit card).

import { ApiError, GoogleGenAI, type Part } from "@google/genai";
import * as z from "zod/v4";
import { groundedResearch } from "./search";
import { AiError, type AiInput, type AiProvider } from "./types";

const list = (value: string | undefined, fallback: string[]) =>
  value ? value.split(",").map((m) => m.trim()).filter(Boolean) : fallback;

// Tried in order: if a model is overloaded (503) or out of free quota (429), the next one is used.
// Free quotas are per model, so falling back also stretches the daily limit.
// (The 2.5 models are closed to new accounts, so they are not in this list.)
const TEXT_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.8-flash",
  ...list(process.env.GEMINI_FALLBACK_MODELS, ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-flash-lite-latest"]),
];

// Errors worth trying another model for: rate limit, server error, overloaded, gateway timeout.
const TRANSIENT = new Set([429, 500, 503, 504]);

// An overloaded model can take minutes to answer 503 when the SDK keeps retrying it.
// Fail fast instead: one attempt per model, a time limit, then move to the next model.
const REQUEST_TIMEOUT_MS = 45_000;

let client: GoogleGenAI | null = null;
function ai() {
  client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } },
  });
  return client;
}

function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) return TRANSIENT.has(error.status);
  return error instanceof Error && (error.name === "AbortError" || /timed out/i.test(error.message));
}

// Models that just failed are skipped for a while, so only one request pays for the slow failure.
const COOLDOWN_MS = 5 * 60_000;
const coolingUntil = new Map<string, number>();

async function withFallback<T>(models: string[], call: (model: string) => Promise<T>): Promise<T> {
  const unique = [...new Set(models)];
  const ready = unique.filter((m) => (coolingUntil.get(m) ?? 0) < Date.now());
  let lastError: unknown;
  // If every model is cooling down, try them all anyway rather than failing.
  for (const model of ready.length ? ready : unique) {
    try {
      const result = await call(model);
      coolingUntil.delete(model);
      return result;
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) break;
      coolingUntil.set(model, Date.now() + COOLDOWN_MS);
      console.warn(`Gemini ${model} unavailable (${error instanceof ApiError ? error.status : "timeout"}), trying next model`);
    }
  }
  if (lastError instanceof Error && !(lastError instanceof ApiError) && isTransient(lastError)) {
    throw new AiError("Gemini is too slow right now (all models timed out). Please retry in a minute.", 504);
  }
  mapError(lastError);
}

function parts(input: AiInput): Part[] {
  const out: Part[] = [];
  if (input.cv?.kind === "pdf") out.push({ inlineData: { mimeType: "application/pdf", data: input.cv.base64 } });
  if (input.cv?.kind === "text") out.push({ text: `<cv filename="${input.cv.name}">\n${input.cv.text}\n</cv>` });
  out.push({ text: input.text });
  return out;
}

function mapError(error: unknown): never {
  if (error instanceof ApiError) {
    if (error.status === 429) throw new AiError("Gemini free-tier limit reached on every model. Wait a minute (or until tomorrow for daily limits) and retry.", 429);
    if (error.status === 503 || error.status === 500 || error.status === 504) {
      throw new AiError("Gemini is overloaded right now (all fallback models were busy). Please retry in a minute.", 503);
    }
    if (error.status === 400 && /api key/i.test(error.message)) throw new AiError("Invalid GEMINI_API_KEY. Check .env.local.", 401);
    if (error.status === 401 || error.status === 403) throw new AiError("GEMINI_API_KEY was rejected. Check .env.local.", 401);
    if (error.status === 404) throw new AiError("Gemini model not found. Check the GEMINI_* model names in .env.local.", 502);
    throw new AiError(`Gemini API error ${error.status}: ${error.message}`, 502);
  }
  throw error;
}

export const gemini: AiProvider = {
  name: "gemini",

  configError() {
    return process.env.GEMINI_API_KEY
      ? null
      : "Missing GEMINI_API_KEY. Get a free key at https://aistudio.google.com/apikey, add it to .env.local and restart.";
  },

  async json({ system, input, schema }) {
    const res = await withFallback(TEXT_MODELS, (model) =>
      ai().models.generateContent({
        model,
        contents: [{ role: "user", parts: parts(input) }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(schema),
        },
      }),
    );
    if (!res.text) throw new AiError("Gemini returned an empty answer. Try again.", 502);
    try {
      return schema.parse(JSON.parse(res.text));
    } catch {
      throw new AiError("Gemini returned malformed data. Try again.", 502);
    }
  },

  async *stream({ system, prompt }) {
    // Fallback applies until the stream opens; after that, chunks arrive from the chosen model.
    const stream = await withFallback(TEXT_MODELS, (model) =>
      ai().models.generateContentStream({ model, contents: prompt, config: { systemInstruction: system } }),
    );
    try {
      for await (const chunk of stream) {
        if (chunk.text) yield chunk.text;
      }
    } catch (error) {
      mapError(error);
    }
  },

  // Gemini's free tier has no Google Search: results come from Tavily (if configured).
  async research({ system, ...opts }) {
    return groundedResearch(opts, async (contents) => {
      const res = await withFallback(TEXT_MODELS, (model) =>
        ai().models.generateContent({ model, contents, config: { systemInstruction: system } }),
      );
      return res.text ?? "";
    });
  },
};
