// Ollama provider: open models running on your own computer. Free, no key, no quota,
// and the CV never leaves the machine. Install from https://ollama.com, then: ollama pull qwen3:4b

import { Ollama, type Message } from "ollama";
import * as z from "zod/v4";
import { pdfToText } from "../pdf";
import { groundedResearch } from "./search";
import { AiError, type AiInput, type AiProvider } from "./types";

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
// Small enough for a 4 GB laptop GPU; set OLLAMA_MODEL for a bigger one (e.g. qwen3:8b, gemma3:12b).
const MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";
// Context window in tokens: enough for a CV plus a batch of offers, without exhausting VRAM.
const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX) || 12288;
// Models with a "thinking" mode: turn it off, it is slow and not needed here.
const THINKING = /qwen3|deepseek-r1/i.test(MODEL);

let client: Ollama | null = null;
const ollama = () => (client ??= new Ollama({ host: HOST }));

const baseRequest = { model: MODEL, ...(THINKING ? { think: false } : {}), options: { num_ctx: NUM_CTX, temperature: 0.3 } };

function mapError(error: unknown): never {
  if (error instanceof AiError) throw error;
  const e = error as { name?: string; message?: string; status_code?: number; cause?: { code?: string } };
  if (e?.name === "ResponseError") {
    if (e.status_code === 404 || /not found|pull/i.test(e.message ?? "")) {
      throw new AiError(`The Ollama model "${MODEL}" isn't downloaded yet. Run: ollama pull ${MODEL}`, 502);
    }
    throw new AiError(`Ollama error: ${e.message}`, 502);
  }
  if (e?.cause?.code === "ECONNREFUSED" || /fetch failed|ECONNREFUSED/i.test(e?.message ?? "")) {
    throw new AiError("Ollama isn't running. Install it from https://ollama.com (it then runs in the background) and retry.", 503);
  }
  throw error;
}

/** Strips a leftover <think>…</think> block some models emit. */
const clean = (text: string) => text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");

async function userText(input: AiInput): Promise<string> {
  let cv = "";
  if (input.cv?.kind === "pdf") cv = await pdfToText(input.cv.base64);
  if (input.cv?.kind === "text") cv = input.cv.text;
  if (input.cv && cv.length < 50) throw new AiError("Could not read text from this PDF (is it a scan?). Paste the CV as text instead.", 422);
  return cv ? `<cv>\n${cv}\n</cv>\n\n${input.text}` : input.text;
}

const messages = (system: string | undefined, content: string): Message[] =>
  system ? [{ role: "system", content: system }, { role: "user", content }] : [{ role: "user", content }];

export const ollamaProvider: AiProvider = {
  name: "ollama",
  local: true,

  configError() {
    return null; // checked on the first call (connection refused → clear message)
  },

  async json({ system, input, schema }) {
    const { $schema: _ignored, ...format } = z.toJSONSchema(schema) as Record<string, unknown>;
    void _ignored;
    const content = await userText(input);
    // Small local models occasionally break the schema: retry once before giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ollama().chat({ ...baseRequest, messages: messages(system, content), format, stream: false });
        const parsed = schema.safeParse(JSON.parse(clean(res.message.content)));
        if (parsed.success) return parsed.data;
      } catch (error) {
        if (!(error instanceof SyntaxError)) mapError(error);
      }
    }
    throw new AiError(`The local model (${MODEL}) returned malformed data. Retry, or use a bigger model via OLLAMA_MODEL.`, 502);
  },

  async *stream({ system, prompt }) {
    let stream;
    try {
      stream = await ollama().chat({ ...baseRequest, messages: messages(system, prompt), stream: true });
    } catch (error) {
      mapError(error);
    }
    let inThink = false;
    try {
      for await (const part of stream) {
        let text = part.message.content;
        // Hide a <think> block if the model still emits one.
        if (text.includes("<think>")) inThink = true;
        if (inThink) {
          if (!text.includes("</think>")) continue;
          text = text.split("</think>").pop() ?? "";
          inThink = false;
        }
        if (text) yield text;
      }
    } catch (error) {
      mapError(error);
    }
  },

  async research({ system, ...opts }) {
    return groundedResearch(opts, async (content) => {
      try {
        const res = await ollama().chat({ ...baseRequest, messages: messages(system, content), stream: false });
        return clean(res.message.content);
      } catch (error) {
        mapError(error);
      }
    });
  },
};
