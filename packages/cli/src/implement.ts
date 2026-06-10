import { existsSync } from "node:fs";
import { join } from "node:path";

import { duskError, verifierEvidenceMaxLines, type VerifierFactory } from "@dusk/core-schema";
import { loadProjectContext } from "@dusk/mcp-server";
import { resumeFrozenBead, runImplement, readRuntimeEnv, type RunImplementDeps, type TaskRunner } from "@dusk/runtime-orchestrator";
import {
  DEFAULT_VERIFIER_SYSTEM_PROMPT,
  claudeCodeAvailable,
  claudeCodeModelClient,
  verifyIntent,
} from "@dusk/runtime-verifier";

/**
 * `dusk implement` / `dusk implement --resume <bead-id>` (14.4/14.5) — the CLI
 * mirror of the `dusk_implement` MCP tool, primarily for debugging. It assembles
 * the runtime deps on the ambient Claude Code model (the Verifier runs on
 * `claude -p`; no API key) and runs the 9-step pipeline. Full Engineer file-write
 * fidelity requires the Claude Code harness's Task tool; outside it this is a
 * best-effort structural run.
 */

const sanityNumber = (config: Record<string, unknown>, key: string, fallback: number): number => {
  const sanity = (config.sanity ?? {}) as Record<string, unknown>;
  return typeof sanity[key] === "number" ? (sanity[key] as number) : fallback;
};

export type ImplementCliResult = { ok: boolean; text: string };

function parseArgs(rest: string[]): { request?: string; resume?: string; scopeHint?: string[] } {
  const resumeIdx = rest.indexOf("--resume");
  if (resumeIdx !== -1) return { resume: rest[resumeIdx + 1] };
  const positional = rest.filter((a) => !a.startsWith("--"));
  return { request: positional[0] };
}

export async function runImplementCli(root: string, rest: string[], opts: { clock?: { now: () => number } } = {}): Promise<ImplementCliResult> {
  const { request, resume } = parseArgs(rest);
  if (!request && !resume) {
    return { ok: false, text: "usage: dusk implement <request> | dusk implement --resume <bead-id|resume-token>\n" };
  }
  if (!claudeCodeAvailable()) {
    return { ok: false, text: "dusk implement needs the Claude Code CLI (`claude`) on PATH (it runs the pipeline on the ambient model — no API key required).\n" };
  }

  // An L3-frozen bead is resumed from its preserved freeze-state.md (§recovery-ladder).
  if (resume && resume.startsWith("bd_")) {
    const freezePath = join(root, ".ia/runtime/beads", resume, "freeze-state.md");
    if (!existsSync(freezePath)) return { ok: false, text: `no frozen bead at ${freezePath}\n` };
  }

  const clock = opts.clock ?? { now: () => Date.now() };
  const modelClient = claudeCodeModelClient({ model: "claude-sonnet-4-6" });
  const baseCtx = loadProjectContext(root, { modelClient, systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT });

  const taskRunner: TaskRunner = async (call) => {
    const completion = await modelClient.complete({ system: call.prompt, user: "Proceed.", temperature: 0 });
    return { output: completion.text, model: "claude-sonnet-4-6", promptTokens: completion.usage.promptTokens, completionTokens: completion.usage.completionTokens, costUsd: completion.usage.costUsd ?? 0, latencyMs: 0 };
  };

  const verifierFactory: VerifierFactory = async (vctx) => {
    const intent = baseCtx.intents.get(vctx.intentPath);
    if (!intent) return duskError("intent_path_unresolved", `intent not found: ${vctx.intentPath}`, { recoverable: true });
    const result = await verifyIntent(intent, { index: baseCtx.index, readFile: baseCtx.readFile, maxLines: verifierEvidenceMaxLines(baseCtx.config), modelClient, systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT });
    return result.success ? result.value : result.error;
  };

  const deps: RunImplementDeps = {
    rootDir: root,
    sessionId: `cli_${clock.now()}`,
    env: readRuntimeEnv(),
    taskRunner,
    verifierFactory,
    buildIndex: () => loadProjectContext(root).index,
    clock,
    config: baseCtx.config,
    perEntryMax: sanityNumber(baseCtx.config, "short_cycle_max_iterations", 20),
    lifetimeMax: sanityNumber(baseCtx.config, "bead_lifetime_iterations", 40),
  };

  // A bead-id resumes an L3-frozen bead from its preserved state; a resume token
  // continues a checkpoint-paused run.
  const result =
    resume && resume.startsWith("bd_")
      ? await resumeFrozenBead(resume, deps)
      : await runImplement(request ? { request } : { resumeToken: resume }, deps);

  if (!result.success) return { ok: false, text: `implement: ${result.error.kind} — ${result.error.message}\n` };
  const s = result.value;
  return { ok: true, text: `implement: ${s.commits.length} commit(s); intents: ${s.intents_touched.join(", ")}; duration ${s.total_duration_ms}ms\n` };
}
