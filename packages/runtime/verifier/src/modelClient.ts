import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * The LLM boundary for the Verifier procedure. Injectable so the deterministic
 * scaffolding (evidence, prompt, inversion, aggregation) is testable without a
 * model, and verdict-correctness tests use the real frontier model at
 * `temperature: 0` (design D12). The procedure builds the prompt and parses the
 * structured JSON; the client just completes.
 */
export type ModelUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
};

export type ModelCompletion = { text: string; usage: ModelUsage };

export type ModelClient = {
  complete(req: { system: string; user: string; temperature?: number }): Promise<ModelCompletion>;
};

/** Rough per-Mtok pricing for cost estimation on traces (USD). */
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

function estimateCost(model: string, inTok: number, outTok: number): number {
  const price = PRICING[model] ?? { in: 3, out: 15 };
  return (inTok * price.in + outTok * price.out) / 1_000_000;
}

export type AnthropicClientOptions = {
  apiKey: string;
  model: string;
  maxTokens?: number;
  now?: () => number;
};

/** Real Anthropic-backed model client at `temperature: 0`. */
export function anthropicModelClient(opts: AnthropicClientOptions): ModelClient {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const now = opts.now ?? (() => Date.now());
  return {
    async complete({ system, user, temperature = 0 }) {
      const start = now();
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 2048,
        temperature,
        system,
        messages: [{ role: "user", content: user }],
      });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      const promptTokens = response.usage.input_tokens;
      const completionTokens = response.usage.output_tokens;
      return {
        text,
        usage: {
          model: opts.model,
          promptTokens,
          completionTokens,
          costUsd: estimateCost(opts.model, promptTokens, completionTokens),
          latencyMs: now() - start,
        },
      };
    },
  };
}

// ---- structured response parsing ------------------------------------------

const ModelTripleSchema = z.object({
  triple_id: z.string(),
  affirmative_holds: z.boolean(),
  rationale: z.string().default(""),
  supports: z
    .array(z.object({ id: z.string(), triple_verdict: z.enum(["matches", "mismatch", "vague"]) }))
    .default([]),
});
export const ModelResponseSchema = z.object({ triples: z.array(ModelTripleSchema) });
export type ModelResponse = z.infer<typeof ModelResponseSchema>;

/** Parse the model's JSON response, tolerating code fences and surrounding prose. */
export function parseModelResponse(text: string): ModelResponse | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = ModelResponseSchema.safeParse(JSON.parse(candidate.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
