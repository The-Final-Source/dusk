import { existsSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

import { type Verdict } from "@dusk/core-schema";
import { loadProjectContext, verifyQuery } from "@dusk/mcp-server";
import { DEFAULT_VERIFIER_SYSTEM_PROMPT, anthropicModelClient } from "@dusk/runtime-verifier";
import { loadRoleFile } from "@dusk/runtime-orchestrator";

/** Human-readable per-triple verdict rendering. */
export function renderVerdicts(verdicts: Verdict[]): string {
  const lines: string[] = [];
  for (const v of verdicts) {
    lines.push(`${v.decision === "accept" ? "ACCEPT" : "REJECT"}  ${v.intent_path}`);
    if (v.implies_antecedent_held === false) {
      lines.push("  (implies antecedent did not hold — consequent not required)");
    }
    for (const t of v.per_triple) {
      lines.push(`  ${t.focal_verdict === "pass" ? "✓" : "✗"} [${t.triple_id}] focal=${t.focal_verdict} support=${t.support_quality} (${t.polarity})`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export type VerifyOptions = { apiKey?: string; model?: string };

/** Resolve a `dusk verify` argument (a file path or an intent scope) to a verify scope. */
function resolveScope(root: string, arg: string): { scope?: string | string[]; intents?: string[] } {
  if (existsSync(arg)) {
    const rel = isAbsolute(arg) ? relative(root, arg) : arg;
    const ctx = loadProjectContext(root);
    const intents = ctx.index.reverse(rel);
    return { intents };
  }
  return { scope: arg };
}

/** `dusk verify <path|scope>` — run the Verifier procedure read-only and print per-triple verdicts. */
export async function runVerify(root: string, arg: string, opts: VerifyOptions): Promise<{ ok: boolean; text: string }> {
  if (!opts.apiKey) {
    return { ok: false, text: "dusk verify requires a configured model (set ANTHROPIC_API_KEY).\n" };
  }
  const modelClient = anthropicModelClient({ apiKey: opts.apiKey, model: opts.model ?? "claude-sonnet-4-6" });
  const role = loadRoleFile(root, "verifier");
  const systemPrompt = role.success ? role.value.body : DEFAULT_VERIFIER_SYSTEM_PROMPT;
  const ctx = loadProjectContext(root, { modelClient, systemPrompt });

  const target = resolveScope(root, arg);
  const result = await verifyQuery(ctx, target);
  if (!result.success) return { ok: false, text: `verify: ${result.error.message}\n` };
  return { ok: true, text: renderVerdicts(result.value.verdicts) };
}
