// Anthropic Claude provider (paid API key from https://platform.claude.com/settings/keys).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Source } from "../types";
import { AiError, type AiInput, type AiProvider } from "./types";

const MODEL = "claude-opus-5-5";

// If Claude declines a request, the API retries it on a fallback model
// chosen by refusal category, inside the same call.
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic();
  return client;
}

function content(input: AiInput): Anthropic.Beta.BetaContentBlockParam[] {
  const out: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.cv?.kind === "pdf") {
    out.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.cv.base64 } });
  }
  if (input.cv?.kind === "text") out.push({ type: "text", text: `<cv filename="${input.cv.name}">\n${input.cv.text}\n</cv>` });
  out.push({ type: "text", text: input.text });
  return out;
}

function mapError(error: unknown): never {
  if (error instanceof Anthropic.AuthenticationError) throw new AiError("Invalid ANTHROPIC_API_KEY. Check .env.local.", 401);
  if (error instanceof Anthropic.RateLimitError) throw new AiError("Rate limited by the Claude API. Try again in a minute.", 429);
  if (error instanceof Anthropic.APIError) throw new AiError(`Claude API error ${error.status}: ${error.message}`, 502);
  throw error;
}

export const claude: AiProvider = {
  name: "claude",

  configError() {
    return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
      ? null
      : "Missing ANTHROPIC_API_KEY. Add it to .env.local and restart, or set AI_PROVIDER=gemini to use the free Gemini tier.";
  },

  async json({ system, input, schema, effort }) {
    try {
      const message = await anthropic().beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort, format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: "user", content: content(input) }],
      });
      if (message.stop_reason === "refusal" || !message.parsed_output) {
        throw new AiError("Claude could not process this request. Try different input.", 422);
      }
      return message.parsed_output;
    } catch (error) {
      mapError(error);
    }
  },

  async *stream({ system, prompt }) {
    const stream = anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      output_config: { effort: "medium" },
      system,
      messages: [{ role: "user", content: prompt }],
    });
    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") yield "\n\n> Claude declined to write this. Try rephrasing your notes.";
      if (final.stop_reason === "max_tokens") yield "\n\n> Output was cut off because it hit the length limit.";
    } catch (error) {
      mapError(error);
    } finally {
      stream.abort();
    }
  },

  async research({ system, prompt, country }) {
    try {
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
      const tools: Anthropic.Beta.BetaToolUnion[] = [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 8,
          ...(country && country !== "any" ? { user_location: { type: "approximate" as const, country: country.toUpperCase() } } : {}),
        },
      ];
      const cited = new Map<string, Source>();
      const consulted = new Map<string, Source>();
      let markdown = "";

      // Long searches can pause the turn; resume up to a few times.
      for (let i = 0; i < 4; i++) {
        const message = await anthropic()
          .beta.messages.stream({ model: MODEL, max_tokens: 32000, ...FALLBACK, output_config: { effort: "medium" }, system, tools, messages })
          .finalMessage();

        for (const block of message.content) {
          if (block.type === "text") {
            markdown += block.text;
            for (const c of block.citations ?? []) {
              if (c.type === "web_search_result_location") cited.set(c.url, { url: c.url, title: c.title ?? c.url });
            }
          } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
            for (const r of block.content) consulted.set(r.url, { url: r.url, title: r.title });
          }
        }
        if (message.stop_reason === "refusal") throw new AiError("Claude could not research this offer.", 422);
        if (message.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: message.content });
      }

      const other = [...consulted.values()].filter((s) => !cited.has(s.url)).slice(0, 8);
      return { markdown, sources: [...cited.values()], other };
    } catch (error) {
      mapError(error);
    }
  },
};
