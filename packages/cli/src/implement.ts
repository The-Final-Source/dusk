import { execFileSync, spawnSync, spawn as spawnChild } from "node:child_process";
import { existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { duskError, isTestIntentPath, verifierEvidenceMaxLines, type DuskConfig, type SpawnOutcome, type VerifierFactory } from "@dusk/core-schema";
import type { DerivedIndex } from "@dusk/core-index";
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
  mergeStructuralSemantic,
  structuralVerdict,
  verifyIntent,
} from "@dusk/runtime-verifier";
import type { TestOutputInterpreter, VitestRunner } from "@dusk/runtime-test-runner";
import { z } from "zod";
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

// RFC App. D.34 (R2): a retryable infrastructure boundary, by the canonical
// classifier kinds — NOT a re-derived ad-hoc string. An empty/degraded verdict
// (`infrastructure_no_verdict`) or a legacy unparseable-response failure is
// retried once at the factory, then surfaced on the no_verdict axis.
const retryableBoundary = (e: { kind: string }): boolean =>
  e.kind === "infrastructure_no_verdict" || e.kind === "verifier_model_call_failed";

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
const IN_FLIGHT = new Set(["short_cycle", "long_cycle", "test_execution", "committing", "paused_livelock", "paused_infrastructure"]);

export const ENGINEER_FILE_INSTRUCTION =
  "\n\n## File-write mode\n\nApply the implementation by EDITING the files in the current working directory directly " +
  "(you have Read/Write/Edit/Glob/Grep tools). Honor the decoration rules: every exported declaration and every " +
  "top-level statement inside a decorated exported function must carry its `// @intent <path> [aspects]` decoration " +
  "(intents live under .ia/intents/). Keep the change minimal and focused on the named intent.\n\n" +
  "## Comment-less files (decoration coverage)\n\nDecoration coverage is universal: EVERY file you write that is not " +
  "ignored must be linked to intents, or the gate will block. Files that CAN hold comments (`.ts`/`.tsx`) carry inline " +
  "`// @intent` as above. Files that CANNOT hold comments — JSON especially (`package.json`, `tsconfig.json`, any " +
  "`.json`) — must instead get a colocated SIDECAR named `<filename.ext>.intent` (e.g. write `package.json.intent` " +
  "beside `package.json`). The sidecar is JSON: `{ \"schema_version\": 1, \"target\": \"<the file>\", \"claims\": " +
  "[{ \"anchor\": \"<JSON Pointer, or \\\"\\\" for the whole file>\", \"marker\": \"intent\"|\"intent-file\", " +
  "\"intent_path\": \"<intent>\" }], \"ignore\": [] }`. Use the whole-file anchor `\"\"` with marker `intent-file` " +
  "unless distinct keys serve distinct intents. NEVER put a comment inside a JSON file; NEVER leave a written " +
  "comment-less file without its sidecar.\n\n" +
  "## Test files (test-pyramid intents)\n\nA TEST intent is one whose path ends in a configured test-pyramid suffix " +
  "(`…/unit-tests`, `…/integration-tests`, `…/e2e-tests`). A file implementing a test-suffix intent MUST claim it with a " +
  "TEST marker — `// @intent-test-file <test-intent-path>` (the whole file is the test body) or `// @intent-test " +
  "<test-intent-path> [covers-…]` (a specific test block) — and NEVER with `@intent`. The test marker is what lets the " +
  "Stage-1 pre-pass FIND the test body it judges; a focal `@intent` on a test-suffix intent is rejected at the gate " +
  "(`non_test_marker_on_test_intent`). (`@intent-support`, and `@intent` claiming a NON-test intent, are still fine " +
  "inside a test file.) See the dusk/engineer/test-file-decoration skill.\n\n" +
  "When you are done, reply with a 1-2 sentence summary of what you changed.";

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

export type VerifierRoute = "prepass" | "structural" | "mixed" | "semantic";

/**
 * Which instrument judges an intent's claims (D.32 / RFC §3.4, App. D.29).
 *
 * The FIRST fork is test-vs-not, decided by the AUTHORED suffix (the single
 * source of truth, D1) — NEVER by the decoration marker (`testDiscovery`). So a
 * test-suffix intent always routes to the Stage-1 test-body pre-pass and can
 * never fall through to ordinary verification; the silent-accept is structurally
 * impossible regardless of whether the Engineer stamped `@intent` or
 * `@intent-test-file` (the marker still LOCATES the body inside the pre-pass —
 * D2 — and a routed test intent with no marker fails loud there — D3).
 *
 * Within the ordinary (non-test) path the structural/semantic channel is an
 * orthogonal axis (D6): all-structural converges with zero LLM; mixed runs both
 * and merges per triple_id; otherwise semantic.
 */
export function chooseVerifierRoute(
  intentPath: string,
  index: Pick<DerivedIndex, "structuralAspects" | "semanticAspects">,
  config: DuskConfig,
): VerifierRoute {
  if (isTestIntentPath(intentPath, config)) return "prepass";
  if (index.structuralAspects(intentPath).length === 0) return "semantic";
  return index.semanticAspects(intentPath).length === 0 ? "structural" : "mixed";
}

/**
 * Assemble the real-dependency `RunImplementDeps` the 9-step pipeline runs on:
 * the ambient-model client (with the transport-failure retry wrapper), the
 * worktree-aware Engineer task runner, the fresh-per-call Verifier factory, and
 * the worktree Vitest runner. Extracted so both `dusk implement` and the MCP
 * stdio server (`dusk mcp`) drive the pipeline through identical wiring rather
 * than two divergent assemblies. Pure construction — issues no model calls.
 */
export function buildImplementDeps(root: string, opts: { clock?: { now: () => number }; baseRef?: string } = {}): RunImplementDeps {
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

  // The agentic bridge for Stage-2 raw output that did NOT yield Dusk's own result
  // schema (RFC App. D.34, decision ①). It may push ONLY toward `fail` or
  // `no_verdict` — NEVER `pass` (enforced MECHANICALLY by the response enum: a
  // "pass", any other value, or an unparseable response resolves to `no_verdict`).
  // The asymmetry guarantees no silent green; a pass requires Dusk's own schema.
  const InterpretSchema = z.object({ outcome: z.enum(["fail", "no_verdict"]), rationale: z.string().optional() });
  const interpretTestOutput: TestOutputInterpreter = async (input) => {
    const user = [
      "A project's test command ran, but Dusk could not read its own structured result schema from the output.",
      "Decide ONLY whether a genuine test FAILURE is present. Answer with JSON only, exactly one of:",
      '{"outcome":"fail","rationale":"<one sentence citing the failing test/assertion>"} — at least one test genuinely failed (an assertion error, a failed/✗ test, a non-zero failure summary); OR',
      '{"outcome":"no_verdict"} — you cannot determine a genuine failure (empty / garbage / crash / OOM / setup-only output).',
      "You may NEVER report a pass — a pass requires the structured result schema that is absent here.",
      `Exit code: ${input.exitCode ?? "null"}`,
      "Output (truncated):",
      input.stdout.slice(0, 4000),
    ].join("\n");
    let text: string;
    try {
      const completion = await modelClient.complete({ system: "You are a Dusk Stage-2 output interpreter. Answer with JSON only; never report a pass.", user, temperature: 0 });
      text = completion.text;
    } catch {
      return { kind: "no_verdict", reason: "tool_infrastructure" }; // a degraded bridge call is infra, never a fabricated verdict
    }
    const match = text.match(/\{[\s\S]*\}/);
    let json: unknown = null;
    if (match) {
      try {
        json = JSON.parse(match[0]);
      } catch {
        json = null;
      }
    }
    const parsed = InterpretSchema.safeParse(json);
    if (!parsed.success) return { kind: "no_verdict", reason: "unparseable" }; // guarded parse — "pass"/garbage → no_verdict
    return parsed.data.outcome === "fail"
      ? { kind: "fail", rationale: parsed.data.rationale ?? "a failing test was read from the raw output" }
      : { kind: "no_verdict", reason: "tool_infrastructure" };
  };

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
    // The instrument is chosen by `chooseVerifierRoute` (D.32 / D1): the
    // test-vs-not fork follows the AUTHORED suffix, not the decoration marker, so
    // a test-suffix intent is ALWAYS judged by the Stage-1 test-body pre-pass
    // (full test bodies, RFC §3.4) and can never fall through to ordinary
    // single-line claim evidence. The marker still LOCATES the body inside the
    // pre-pass (D2); a routed test intent with no marker fails loud there (D3).
    const route = chooseVerifierRoute(vctx.intentPath, ctx.index, ctx.config);
    if (route === "prepass") {
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
    // Structural triples (per-file `<file>.intent` sidecars, `verify: "structural"`)
    // are satisfied MECHANICALLY — anchor resolves + coverage holds — never by the
    // semantic LLM (RFC App. D.29). The index partitions them out of the semantic
    // evidence set, so the LLM path would fail them forever and loop a config
    // intent until budget. Route by channel: all-structural → zero-LLM verdict
    // (converges iteration 1); mixed → run both and merge per triple_id.
    if (route === "structural" || route === "mixed") {
      const structuralIds = ctx.index.structuralAspects(vctx.intentPath);
      const semanticIds = ctx.index.semanticAspects(vctx.intentPath);
      const structural = structuralVerdict(vctx.intentPath, { index: ctx.index, intents: ctx.intents, readFile: ctx.readFile });
      if (route === "structural") return structural.success ? structural.value : structural.error;
      if (!structural.success) return structural.error;
      let semantic = await verifyOnce();
      if (!semantic.success && retryableBoundary(semantic.error)) semantic = await verifyOnce();
      if (!semantic.success) return semantic.error;
      return mergeStructuralSemantic(structural.value, semantic.value, new Set(structuralIds), new Set(semanticIds), intent.compose);
    }
    let result = await verifyOnce();
    // An empty/degraded or non-JSON model response is an infrastructure boundary
    // (RFC App. D.34): retry once (transport-style), then surface it on the
    // no_verdict axis — never a content reject. The retry condition references the
    // canonical classifier kinds (one vocabulary, R2), not an ad-hoc string.
    if (!result.success && retryableBoundary(result.error)) result = await verifyOnce();
    return result.success ? result.value : result.error;
  };

  // Stage-2 runs inside the worktree package; node_modules are linked from the
  // main checkout (worktrees are bare source checkouts). Capture is NON-THROWING
  // (spawnSync): a non-zero exit is DATA (RFC App. D.34, gap #3). Interpretation is
  // the Dusk-result-schema floor in the Test Runner — this command's reporter is
  // configured project-side to emit Dusk's own result schema (the Phase-VI adapter
  // task); until then a raw report resolves to `no_verdict`, never a silent green.
  const vitestRunner: VitestRunner = (files, cwd) => {
    const pkgDir = activeWorktreePackageDir() ?? cwd;
    const worktreeRoot = packageRel && pkgDir.endsWith(packageRel) ? pkgDir.slice(0, pkgDir.length - packageRel.length - 1) : pkgDir;
    for (const [target, source] of [
      [join(worktreeRoot, "node_modules"), join(repoRoot, "node_modules")],
      [join(pkgDir, "node_modules"), join(root, "node_modules")],
    ] as const) {
      if (!existsSync(target) && existsSync(source)) symlinkSync(source, target, "dir");
    }
    const r = spawnSync("pnpm", ["vitest", "run", ...files, "--reporter=json"], { cwd: pkgDir, encoding: "utf8" });
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || r.signal === "SIGKILL" || r.signal === "SIGTERM";
    return { stdout: r.stdout ?? "", exitCode: r.status, timedOut };
  };

  return {
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
    noVerdictMax: sanityNumber(baseCtx.config, "no_verdict_max_iterations", 3),
    vitestRunner,
    interpretTestOutput,
    ...(opts.baseRef ? { baseRef: opts.baseRef } : {}),
  };
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

  const deps = buildImplementDeps(root, { ...(opts.clock ? { clock: opts.clock } : {}), ...(baseRef ? { baseRef } : {}) });

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
