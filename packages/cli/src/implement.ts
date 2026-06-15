import { execFileSync, spawn as spawnChild } from "node:child_process";
import { existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { duskError, verifierEvidenceMaxLines, type SpawnOutcome, type VerifierFactory } from "@dusk/core-schema";
import {
  computeSidecarCoverage,
  createIgnoreMatcher,
  loadIgnoreGlobs,
  nonTrivialLines,
  parseFileIntentSidecar,
} from "@dusk/core-decoration";
import { isGatedFile, runGate } from "@dusk/pre-tool-use";
import type { GateResult } from "@dusk/runtime-short-cycle";
import { loadProjectContext } from "@dusk/mcp-server";

import { loadConfig } from "./project.js";
import {
  getActiveRun,
  resumeFrozenBead,
  runImplement,
  readRuntimeEnv,
  type RunImplementDeps,
  type TaskRunner,
} from "@dusk/runtime-orchestrator";
import { worktreePathFor } from "@dusk/runtime-worktree";
import {
  DEFAULT_VERIFIER_SYSTEM_PROMPT,
  claudeCodeAvailable,
  claudeCodeModelClient,
  verifyIntent,
} from "@dusk/runtime-verifier";
import type { VitestRunner } from "@dusk/runtime-test-runner";
import { realTestPrepassVerdict, withTransportRetry } from "@dusk/runtime-benchmark";
import type { ModelClient } from "@dusk/runtime-verifier";

/**
 * `dusk implement` / `dusk implement --resume <bead-id>` (14.4/14.5) — the CLI
 * mirror of the `dusk_implement` MCP tool. Runs the 9-step pipeline on the
 * ambient Claude Code model (no API key). Phase-5 dogfood upgrade (previously a
 * text-only structural run):
 *
 *  - The ENGINEER spawns as a headless `claude -p` agent WITH file tools,
 *    working inside the active bead's worktree (real file writes).
 *  - The VERIFIER rebuilds its evidence context from the active worktree per
 *    call, so verdicts judge the engineer's actual draft at temperature 0.
 *  - Stage-2 Vitest runs inside the worktree package (node_modules linked from
 *    the main checkout — worktrees are bare source checkouts).
 */

const sanityNumber = (config: Record<string, unknown>, key: string, fallback: number): number => {
  const sanity = (config.sanity ?? {}) as Record<string, unknown>;
  return typeof sanity[key] === "number" ? (sanity[key] as number) : fallback;
};

/**
 * The headless engineer's enforcement boundary — the REAL mechanical gate for
 * `dusk implement` (RFC §4.6). The headless `claude --print` engineer's writes
 * do NOT pass through the interactive Claude Code PreToolUse hook (no
 * settings.json is provisioned into its worktree, and it runs
 * `--permission-mode acceptEdits`). Instead the short cycle gates the engineer's
 * draft HERE, post-hoc: scan the worktree's changed files and run every GATED
 * file (the shared `isGatedFile` set — `.ts`/`.tsx` and `.intent`, aligned with
 * runGate so the two enforcement paths can't disagree on WHICH files to check)
 * through the SAME `runGate` mechanical checks the hook runs. A block re-drafts
 * WITHOUT spawning the verifier (§6.2).
 *
 * Pure over a worktree root (exported for unit tests). Uses `git status
 * --porcelain -z -uall`: `-z` is NUL-separated + UNQUOTED so paths with
 * special chars parse correctly (plain `--porcelain` quotes them, which
 * `slice(3)` would mangle into a silent fail-open); `-uall` lists every
 * untracked FILE individually (default `--porcelain` collapses an untracked
 * directory to one `dir/` entry, so new files in a new dir would escape the
 * gate entirely — a fail-open).
 */
export function gateWorktreeEdits(worktreeRoot: string): GateResult {
  let raw: string;
  try {
    raw = execFileSync("git", ["-C", worktreeRoot, "status", "--porcelain", "-z", "-uall"], { encoding: "utf8" });
  } catch {
    return { blocked: false };
  }
  // -z entries are `XY <path>` terminated by NUL (status = 2 cols + a space).
  const changedAll = raw.split("\0").filter((e) => e.length > 3).map((e) => e.slice(3));
  const isIgnored = createIgnoreMatcher(loadIgnoreGlobs(loadConfig(worktreeRoot)));
  const changed = changedAll.filter((rel) => !isIgnored(rel)); // the ignore SSoT — never gate/coverage-check an ignored file

  // Phase 1 — per-file structural validity (gated files only), as today.
  for (const rel of changed.filter(isGatedFile)) {
    const abs = join(worktreeRoot, rel);
    if (!existsSync(abs)) continue;
    const out = runGate({ tool: "Write", args: { file_path: abs, content: readFileSync(abs, "utf8") } });
    if (out.decision === "block") {
      return { blocked: true, rejection: `gate: ${out.structured_rejection.kind} at ${rel}:${out.structured_rejection.line} — ${out.reason}` };
    }
  }

  // Phase 2 — whole-worktree coverage tiling over the settled pair-state, where
  // both a target and its sidecar are present and write-order is irrelevant
  // (design D7; the per-write hook cannot express this cross-file check).
  return tileWorktreeCoverage(worktreeRoot, changed);
}

/** Is `rel` a per-file sidecar (`<stem>.intent`, not the directory `.intent`)? */
const isSidecar = (rel: string): boolean => rel.endsWith(".intent") && basename(rel) !== ".intent";
/** A comment-less, structured (JSON/JSONC) target that requires sidecar coverage. */
const isCommentlessTarget = (rel: string): boolean => /\.jsonc?$/.test(rel);

/**
 * Phase 2 of the post-hoc gate: pair each non-ignored target with its sidecar
 * and compute `uncovered = non-trivial-lines − covered − ignored` over the
 * settled worktree. Findings name the TARGET's `file:line` (board M4), never the
 * sidecar's. A changed comment-less target with no sidecar is fully uncovered.
 */
function tileWorktreeCoverage(worktreeRoot: string, changed: string[]): GateResult {
  const block = (kind: string, rel: string, line: number, reason: string): GateResult => ({
    blocked: true,
    rejection: `gate: ${kind} at ${rel}:${line} — ${reason}`,
  });
  const handled = new Set<string>();

  for (const sidecarRel of changed.filter(isSidecar)) {
    const sidecarAbs = join(worktreeRoot, sidecarRel);
    if (!existsSync(sidecarAbs)) continue; // deleted in the settled state
    const targetRel = join(dirname(sidecarRel), basename(sidecarRel).slice(0, -".intent".length));
    handled.add(targetRel);
    const targetAbs = join(worktreeRoot, targetRel);
    if (!existsSync(targetAbs)) {
      return block("sidecar_target_missing", sidecarRel, 1, `target "${targetRel}" does not exist beside the sidecar`);
    }
    const targetSource = readFileSync(targetAbs, "utf8");
    const parse = parseFileIntentSidecar(readFileSync(sidecarAbs, "utf8"), targetSource, sidecarRel, targetRel);
    const malformed = parse.findings.find((f) => f.kind === "malformed_sidecar");
    if (malformed) return block("malformed_sidecar", sidecarRel, 1, malformed.message);
    const dangling = parse.findings.find((f) => f.kind === "unresolved_anchor");
    if (dangling) return block("unresolved_anchor", sidecarRel, 1, `pointer "${dangling.anchor}" does not resolve against ${targetRel}`);

    const cov = computeSidecarCoverage(targetSource, parse.claimSpans, parse.ignoreSpans);
    if (cov.overlaps.length > 0) {
      const { a, b } = cov.overlaps[0];
      return block("overlapping_anchors", targetRel, 1, `claims "${a}" and "${b}" resolve to overlapping spans`);
    }
    if (cov.uncoveredLines.length > 0) {
      return block("uncovered_target_lines", targetRel, cov.uncoveredLines[0], `${cov.uncoveredLines.length} non-trivial line(s) covered by no claim or @intent-ignore`);
    }
  }

  // A changed comment-less target with NO sidecar is entirely uncovered.
  for (const rel of changed) {
    if (isSidecar(rel) || !isCommentlessTarget(rel) || handled.has(rel)) continue;
    const abs = join(worktreeRoot, rel);
    if (!existsSync(abs)) continue;
    const required = nonTrivialLines(readFileSync(abs, "utf8"));
    if (required.size > 0) {
      const first = Math.min(...required);
      return block("uncovered_target_lines", rel, first, `comment-less target has no ${basename(rel)}.intent sidecar; ${required.size} non-trivial line(s) uncovered`);
    }
  }

  return { blocked: false };
}

export type ImplementCliResult = { ok: boolean; text: string };

function parseArgs(rest: string[]): { request?: string; resume?: string; scopeHint?: string[]; baseRef?: string } {
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    return i !== -1 && i + 1 < rest.length ? rest[i + 1] : undefined;
  };
  const resume = flag("--resume");
  const scope = flag("--scope");
  const baseRef = flag("--base-ref");
  const flagValues = new Set([resume, scope, baseRef].filter(Boolean));
  const positional = rest.filter((a) => !a.startsWith("--") && !flagValues.has(a));
  return {
    ...(resume ? { resume } : { request: positional[0] }),
    ...(scope ? { scopeHint: scope.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
    ...(baseRef ? { baseRef } : {}),
  };
}

const ENGINEER_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];
const IN_FLIGHT = new Set(["short_cycle", "long_cycle", "test_execution", "committing", "paused_livelock"]);

const ENGINEER_FILE_INSTRUCTION =
  "\n\n## File-write mode\n\nApply the implementation by EDITING the files in the current working directory directly " +
  "(you have Read/Write/Edit/Glob/Grep tools). Honor the decoration rules: every exported declaration and every " +
  "top-level statement inside a decorated exported function must carry its `// @intent <path> [aspects]` decoration " +
  "(intents live under .ia/intents/). Keep the change minimal and focused on the named intent. When you are done, " +
  "reply with a 1-2 sentence summary of what you changed.";

/**
 * Run a headless file-capable Claude Code agent and return its final text.
 *
 * The engineer is NOT turn-capped: it does as much real file work in one spawn
 * as it needs (capping turns would only force the next — memory-less — iteration
 * to cold-re-derive the worktree). The wall clock is a hang backstop, and on it
 * we DO NOT kill the run: the partial draft is already on disk in the worktree,
 * so we resolve with a salvage marker and let the short cycle re-enter and
 * continue from the existing files. (Greenfield robustness: a budget overrun is
 * a "continue", never a discard-and-die — and never a transport-classified
 * cold-retry of the identical too-large task.)
 */
function runHeadlessAgent(
  prompt: string,
  cwd: string,
  model: string,
  timeoutMs: number,
): Promise<{ text: string; costUsd: number; promptTokens: number; completionTokens: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const args = ["--print", "--output-format", "json", "--model", model, "--allowed-tools", ENGINEER_TOOLS.join(","), "--permission-mode", "acceptEdits"];
    const child = spawnChild("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let errText = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        text: "(engineer wall-clock budget reached; the partial draft is preserved in the worktree — continue from the existing files)",
        costUsd: 0,
        promptTokens: 0,
        completionTokens: 0,
      });
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (errText += d));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${errText.slice(0, 500)} ${out.slice(0, 500)}`));
      try {
        const parsed = JSON.parse(out) as { result?: unknown; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } };
        resolve({
          text: typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result ?? {}),
          costUsd: parsed.total_cost_usd ?? 0,
          promptTokens: parsed.usage?.input_tokens ?? 0,
          completionTokens: parsed.usage?.output_tokens ?? 0,
        });
      } catch (e) {
        reject(e);
      }
    });
    // A child exiting before draining stdin raises EPIPE on the write side;
    // unhandled, it would crash the whole pipeline process.
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export async function runImplementCli(root: string, rest: string[], opts: { clock?: { now: () => number } } = {}): Promise<ImplementCliResult> {
  const { request, resume, scopeHint, baseRef } = parseArgs(rest);
  if (!request && !resume) {
    return { ok: false, text: "usage: dusk implement <request> [--scope <intent,..>] [--base-ref <ref>] | dusk implement --resume <bead-id|resume-token>\n" };
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
  const model = "claude-sonnet-4-6";
  // The pre-registered transport-failure amendment applies to every real-model
  // call: a transport blip is a null observation consuming one retry — it must
  // not kill a long pipeline run. Two deaths still fail honestly.
  const rawModelClient = claudeCodeModelClient({ model });
  const modelClient: ModelClient = {
    complete: (req) => withTransportRetry(() => rawModelClient.complete(req)),
  };
  const baseCtx = loadProjectContext(root, { modelClient, systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT });

  // The project may be a package INSIDE the repo: worktrees are full-repo
  // checkouts, so the package's path within a worktree is its repo-relative path.
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).trim();
  const packageRel = relative(repoRoot, root);

  /** The active bead's package directory inside its worktree (null between beads). */
  const activeWorktreePackageDir = (): string | null => {
    const run = getActiveRun();
    const bead = run ? [...run.beads.values()].find((b) => IN_FLIGHT.has(b.status)) : undefined;
    if (!bead) return null;
    let worktree = worktreePathFor(root, bead.id);
    if (!existsSync(worktree)) {
      // Non-first beads of a worktree GROUP run in the group's worktree (named
      // after its first bead) — fall back to the single active group worktree.
      const base = join(root, ".ia/runtime/worktrees");
      const dirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith("bd_")) : [];
      if (dirs.length !== 1) return null;
      worktree = join(base, dirs[0]);
    }
    const pkgDir = packageRel ? join(worktree, packageRel) : worktree;
    return existsSync(pkgDir) ? pkgDir : null;
  };

  /** The active worktree's repo root (the package dir minus the package-relative suffix). */
  const activeWorktreeRoot = (): string | null => {
    const pkgDir = activeWorktreePackageDir();
    if (!pkgDir) return null;
    return packageRel && pkgDir.endsWith(packageRel) ? pkgDir.slice(0, pkgDir.length - packageRel.length - 1) : pkgDir;
  };

  // The headless engineer is gated POST-HOC, in-process, over its worktree diff
  // (NOT via the interactive Claude Code PreToolUse hook — see gateWorktreeEdits).
  const gate = (_engineer: SpawnOutcome): GateResult => {
    const worktreeRoot = activeWorktreeRoot();
    return worktreeRoot ? gateWorktreeEdits(worktreeRoot) : { blocked: false };
  };

  const taskRunner: TaskRunner = async (call) => {
    if (call.subagentType === "dusk-engineer") {
      // Phase-5 dogfood mode: the Engineer is a REAL file-writing headless agent
      // working inside the active bead's worktree.
      const cwd = activeWorktreePackageDir() ?? root;
      const result = await withTransportRetry(() => runHeadlessAgent(`${call.prompt}${ENGINEER_FILE_INSTRUCTION}`, cwd, model, 15 * 60 * 1000));
      return { output: result.text, model, promptTokens: result.promptTokens, completionTokens: result.completionTokens, costUsd: result.costUsd, latencyMs: 0 };
    }
    const completion = await modelClient.complete({ system: call.prompt, user: "Proceed.", temperature: 0 });
    return { output: completion.text, model, promptTokens: completion.usage.promptTokens, completionTokens: completion.usage.completionTokens, costUsd: completion.usage.costUsd ?? 0, latencyMs: 0 };
  };

  // The Verifier judges the engineer's ACTUAL DRAFT: its evidence context is
  // rebuilt from the active worktree per call (fresh per call, temperature 0).
  const verifierFactory: VerifierFactory = async (vctx) => {
    const pkgDir = activeWorktreePackageDir();
    const ctx = pkgDir ? loadProjectContext(pkgDir, { modelClient, systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT }) : baseCtx;
    const intent = ctx.intents.get(vctx.intentPath) ?? baseCtx.intents.get(vctx.intentPath);
    if (!intent) return duskError("intent_path_unresolved", `intent not found: ${vctx.intentPath}`, { recoverable: true });
    // Test intents are judged by the Stage-1 test-body pre-pass instrument
    // (full test bodies, RFC §3.4) — never by single-line claim evidence.
    if (ctx.index.testDiscovery(vctx.intentPath).length > 0) {
      const prepass = await realTestPrepassVerdict(vctx.intentPath, { index: ctx.index, intents: ctx.intents, readFile: ctx.readFile, modelClient });
      return prepass.success ? prepass.value : prepass.error;
    }
    const verifyOnce = () =>
      verifyIntent(intent, {
        index: ctx.index,
        readFile: ctx.readFile,
        maxLines: verifierEvidenceMaxLines(baseCtx.config),
        modelClient,
        systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT,
        onUsage: vctx.reportUsage,
      });
    let result = await verifyOnce();
    // A non-JSON model response is recoverable noise (one retry, like transport)
    // — it must not kill a long pipeline run as "no verdict".
    if (!result.success && result.error.kind === "verifier_model_call_failed") result = await verifyOnce();
    return result.success ? result.value : result.error;
  };

  // Stage-2 Vitest runs inside the worktree package; node_modules are linked
  // from the main checkout (worktrees are bare source checkouts).
  const vitestRunner: VitestRunner = (files, cwd) => {
    const pkgDir = activeWorktreePackageDir() ?? cwd;
    const worktreeRoot = packageRel && pkgDir.endsWith(packageRel) ? pkgDir.slice(0, pkgDir.length - packageRel.length - 1) : pkgDir;
    for (const [target, source] of [
      [join(worktreeRoot, "node_modules"), join(repoRoot, "node_modules")],
      [join(pkgDir, "node_modules"), join(root, "node_modules")],
    ] as const) {
      if (!existsSync(target) && existsSync(source)) symlinkSync(source, target, "dir");
    }
    return execFileSync("pnpm", ["vitest", "run", ...files, "--reporter=json"], { cwd: pkgDir, encoding: "utf8" });
  };

  const deps: RunImplementDeps = {
    rootDir: root,
    sessionId: `cli_${clock.now()}`,
    env: readRuntimeEnv(),
    taskRunner,
    verifierFactory,
    gate,
    buildIndex: () => loadProjectContext(root).index,
    clock,
    config: baseCtx.config,
    perEntryMax: sanityNumber(baseCtx.config, "short_cycle_max_iterations", 20),
    lifetimeMax: sanityNumber(baseCtx.config, "bead_lifetime_iterations", 40),
    vitestRunner,
    ...(baseRef ? { baseRef } : {}),
  };

  // A bead-id resumes an L3-frozen bead from its preserved state; a resume token
  // continues a checkpoint-paused run.
  const result =
    resume && resume.startsWith("bd_")
      ? await resumeFrozenBead(resume, deps)
      : await runImplement(request ? { request, ...(scopeHint ? { scopeHint } : {}) } : { resumeToken: resume }, deps);

  if (!result.success) return { ok: false, text: `implement: ${result.error.kind} — ${result.error.message}\n` };
  const s = result.value;
  return { ok: true, text: `implement: ${s.commits.length} commit(s); intents: ${s.intents_touched.join(", ")}; duration ${s.total_duration_ms}ms\n` };
}
