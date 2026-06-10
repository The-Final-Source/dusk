import { execFileSync, spawn } from "node:child_process";

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

// ---- Claude Code (ambient auth, no API key) -------------------------------

export type ClaudeCodeClientOptions = {
  model?: string;
  /** The `claude` CLI binary (default: resolved from PATH). */
  cliPath?: string;
  timeoutMs?: number;
  now?: () => number;
};

const DISABLED_TOOLS = ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "Task", "WebFetch", "WebSearch"];

function runClaude(cli: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("claude CLI timed out"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 500)}`));
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Model client backed by the locally-available Claude Code CLI in headless mode
 * (`claude -p --output-format json`). Uses the ambient Claude Code authentication —
 * NO separate API key. This is the faithful Phase-2 model boundary: the Verifier
 * runs on the same model access the harness already has (RFC §9.9). Tools are
 * disabled — the Verifier only emits the requested JSON.
 */
export function claudeCodeModelClient(opts: ClaudeCodeClientOptions = {}): ModelClient {
  const model = opts.model ?? "claude-sonnet-4-6";
  const cli = opts.cliPath ?? "claude";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const now = opts.now ?? (() => Date.now());
  return {
    async complete({ system, user }) {
      const start = now();
      const args = ["--print", "--output-format", "json", "--model", model, "--max-turns", "1"];
      if (system) args.push("--system-prompt", system);
      args.push("--disallowed-tools", ...DISABLED_TOOLS); // variadic — keep last
      const raw = await runClaude(cli, args, user, timeoutMs);
      const parsed = JSON.parse(raw) as { result?: unknown; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } };
      const usage = parsed.usage ?? {};
      return {
        text: typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result ?? {}),
        usage: {
          model,
          promptTokens: usage.input_tokens ?? 0,
          completionTokens: usage.output_tokens ?? 0,
          costUsd: parsed.total_cost_usd ?? 0,
          latencyMs: now() - start,
        },
      };
    },
  };
}

/** Probe whether the Claude Code CLI is invocable (for test gating). */
export function claudeCodeAvailable(cliPath = "claude"): boolean {
  try {
    execFileSync(cliPath, ["--version"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
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
