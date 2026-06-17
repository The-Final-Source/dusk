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

/**
 * If a non-zero CLI exit nonetheless carried a well-formed result envelope with
 * an error subtype (`{"type":"result","subtype":"error_*",…}`), return that
 * subtype — the signal that this is a DETERMINISTIC content/limit failure (the
 * plumbing succeeded, the model ran), NOT transport plumbing noise (RFC App.
 * D.33). Returns null for a genuine plumbing failure (no parseable envelope).
 * Parses the FULL stdout (not the truncated diagnostic message).
 */
export function modelExitSubtype(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { type?: unknown; subtype?: unknown };
    if (parsed?.type === "result" && typeof parsed.subtype === "string" && parsed.subtype.startsWith("error_")) {
      return parsed.subtype;
    }
  } catch {
    // Not a JSON envelope — a genuine plumbing failure; leave untagged (transport).
  }
  return null;
}

type ClaudeEnvelope = { result?: unknown; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } };

/**
 * Guard the success-path `--output-format json` parse (RFC App. D.34, gap #7). A
 * malformed envelope is transport PLUMBING noise (the bytes never parsed into the
 * CLI's own result shape), NOT content. Re-thrown as a `SyntaxError` so
 * `isTransportError` classifies it transport (`modelCallError.ts`) and the spawn
 * seam surfaces it as a returned failure — NEVER an uncaught crash. (This makes
 * the always-mitigated-at-the-seam behavior explicit + legible at the source.)
 */
export function parseClaudeEnvelope(raw: string): ClaudeEnvelope {
  try {
    return JSON.parse(raw) as ClaudeEnvelope;
  } catch (e) {
    throw new SyntaxError(
      `claude CLI returned an unparseable --output-format json envelope (${raw.length} bytes): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

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
      if (code === 0) return resolve(out);
      // The CLI reports many failures as JSON on STDOUT with a non-zero exit —
      // include both streams so transport errors are diagnosable.
      const error = new Error(`claude CLI exited ${code}: ${err.slice(0, 500)} ${out.slice(0, 500)}`);
      // A non-zero exit that produced a well-formed result envelope with an error
      // subtype (e.g. `error_max_turns`) is a DETERMINISTIC content/limit failure
      // — tag it so `isTransportError` classifies it non-transport (no pointless
      // cold-retry of an identical deterministic call) and the spawn seam surfaces
      // it as a returned failure instead of crashing the run (RFC App. D.33).
      const subtype = modelExitSubtype(out);
      if (subtype) (error as Error & { duskModelExit?: string }).duskModelExit = subtype;
      reject(error);
    });
    // A child that exits before draining stdin raises EPIPE on the write side;
    // unhandled, that crashes the WHOLE process (not just this call). Swallow
    // it — the `close` handler reports the real exit honestly.
    child.stdin.on("error", () => {});
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
      // No tools: `--tools ""` removes the entire tool surface from the request (a
      // zero-tool ALLOWLIST), so `tool_use` is structurally impossible — unlike the
      // former `--disallowed-tools` DENYLIST, which still registered the tools (the
      // model could attempt them, burning turns) and was incomplete vs the CLI's
      // real tool set. `--max-turns 3` is kept purely as a blast-radius backstop;
      // if the cap is ever hit (e.g. via an MCP tool `--tools ""` doesn't suppress)
      // the resulting `error_max_turns` is now classified non-transport and surfaced
      // as a returned failure, NEVER a fatal cold-retried crash (RFC App. D.33).
      // Tool suppression here is defense-in-depth, never the correctness guarantee.
      const args = ["--print", "--output-format", "json", "--model", model, "--max-turns", "3"];
      const noTools = "You have NO tools available in this context. Never attempt a tool call; reply directly with the requested output only.";
      args.push("--system-prompt", system ? `${system}\n\n${noTools}` : noTools);
      args.push("--tools", ""); // zero-tool allowlist — keep last
      const raw = await runClaude(cli, args, user, timeoutMs);
      const parsed = parseClaudeEnvelope(raw);
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
