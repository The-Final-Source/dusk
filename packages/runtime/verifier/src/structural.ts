import type { DerivedIndex } from "@dusk/core-index";
import { computeSidecarCoverage, parseFileIntentSidecar } from "@dusk/core-decoration";
import { duskError, type Intent, type PerTripleVerdict, type RuntimeResult, type Verdict } from "@dusk/core-schema";

/**
 * The structural (mechanical) Verifier — RFC App. D.29. A triple whose focal
 * claimant is a per-file `<file>.intent` sidecar record (`verify: "structural"`)
 * cannot be judged by the semantic LLM Verifier: the index deliberately
 * partitions structural records OUT of `semanticRecords` (design D6), so such a
 * triple has no semantic evidence and the LLM path would fail it forever — the
 * short cycle would re-draft a config intent until budget (the greenfield-POC
 * config-through-dusk loop). This evaluator satisfies a structural triple the
 * ONLY way it can be satisfied: MECHANICALLY — its sidecar anchor resolves
 * against the live target AND the target is fully decoration-covered.
 *
 * It reuses the SAME primitives as the pre-tool-use gate
 * (`parseFileIntentSidecar` + `computeSidecarCoverage`) so the gate and the
 * verifier can never disagree on whether a target is covered. Zero LLM calls →
 * a structural-only intent converges on iteration 1.
 */

export type StructuralDeps = {
  index: DerivedIndex;
  intents: Map<string, Intent>;
  /** Reads a repo-relative path against the live (worktree) checkout. */
  readFile: (file: string) => string;
};

const STRUCTURAL_FOCAL = new Set(["intent", "intent-file"]);

function intentTriples(intent: Intent) {
  return intent.compose === "implies" ? (intent.consequent ?? []) : (intent.triples ?? []);
}

type TargetCheck = { ok: true } | { ok: false; reason: string };

/**
 * Mechanically evaluate one comment-less target's coverage from its
 * `<file>.intent` sidecar. Mirrors the gate's per-pair tiling exactly (same
 * primitives), so a target the gate accepted always passes here too.
 */
function evaluateTarget(targetFile: string, deps: StructuralDeps): TargetCheck {
  let targetSource: string;
  try {
    targetSource = deps.readFile(targetFile);
  } catch {
    return { ok: false, reason: `target "${targetFile}" is unreadable` };
  }
  const sidecarFile = `${targetFile}.intent`;
  let sidecarSource: string;
  try {
    sidecarSource = deps.readFile(sidecarFile);
  } catch {
    return { ok: false, reason: `sidecar "${sidecarFile}" is missing` };
  }
  const parse = parseFileIntentSidecar(sidecarSource, targetSource, sidecarFile, targetFile);
  const malformed = parse.findings.find((f) => f.kind === "malformed_sidecar");
  if (malformed) return { ok: false, reason: `malformed sidecar: ${malformed.message}` };
  const dangling = parse.findings.find((f) => f.kind === "unresolved_anchor");
  if (dangling) return { ok: false, reason: `sidecar pointer "${dangling.anchor}" does not resolve against ${targetFile}` };
  const cov = computeSidecarCoverage(targetSource, parse.claimSpans, parse.ignoreSpans);
  if (cov.overlaps.length > 0) return { ok: false, reason: `claims "${cov.overlaps[0].a}" and "${cov.overlaps[0].b}" resolve to overlapping spans` };
  if (cov.uncoveredLines.length > 0) {
    return { ok: false, reason: `${cov.uncoveredLines.length} non-trivial line(s) uncovered (first: ${targetFile}:${cov.uncoveredLines[0]})` };
  }
  return { ok: true };
}

/**
 * Verify a structural intent with zero LLM calls. Every triple of the intent is
 * judged: a triple with a structural focal claimant passes iff every target
 * backing it resolves + is fully covered; a triple with NO structural claimant
 * fails (uncovered aspect). All verdicts carry `channel: "mechanical"`.
 */
export function structuralVerdict(intentPath: string, deps: StructuralDeps): RuntimeResult<Verdict> {
  const intent = deps.intents.get(intentPath);
  if (!intent) {
    return { success: false, error: duskError("intent_path_unresolved", `intent not found: ${intentPath}`, { recoverable: true }) };
  }
  const triples = intentTriples(intent);
  const structuralIds = new Set(deps.index.structuralAspects(intentPath));
  // Gather focal claimants by MARKER, not by record `verify`: an inline claim on
  // a comment-bearing config file (e.g. vitest.config.ts) the author marked
  // `verify: structural` is stamped `semantic` on the record (modality), but the
  // triple is structural (D.30). The channel decision is already made by
  // `structuralAspects`; here we only mechanically check the claimants.
  const focalRecords = deps.index.forward(intentPath).filter((r) => STRUCTURAL_FOCAL.has(r.marker));

  // One config file backs many triples — evaluate each target at most once.
  const cache = new Map<string, TargetCheck>();
  const coverOf = (file: string): TargetCheck => {
    const hit = cache.get(file);
    if (hit) return hit;
    const res = evaluateTarget(file, deps);
    cache.set(file, res);
    return res;
  };

  const per_triple: PerTripleVerdict[] = triples.map((t) => {
    const base = {
      triple_id: t.id,
      channel: "mechanical" as const,
      support_quality: "ok" as const,
      polarity: t.polarity,
      evidence: { support_claims: [] },
    };
    if (!structuralIds.has(t.id)) {
      return { ...base, focal_verdict: "fail" as const, rationale: "no structural claimant: aspect is verified semantically or uncovered" };
    }
    const claimants = focalRecords.filter((r) => r.aspect_ids === null || r.aspect_ids.includes(t.id));
    if (claimants.length === 0) {
      return { ...base, focal_verdict: "fail" as const, rationale: "no structural claimant: aspect is uncovered by any decoration" };
    }
    // A sidecar claimant (anchor present) is checked by JSON coverage tiling; an
    // inline claimant (anchor null) on a comment-bearing file IS the anchor — its
    // presence in the live index means the decoration resolved, and the file's
    // line-coverage is already enforced by the gate. So inline claims pass on
    // presence; only sidecar targets need a coverage check here.
    const sidecarTargets = [...new Set(claimants.filter((r) => r.anchor != null).map((r) => r.file))];
    const broken = sidecarTargets.map((f) => ({ f, res: coverOf(f) })).find((x) => !x.res.ok);
    if (broken && !broken.res.ok) {
      return { ...base, focal_verdict: "fail" as const, rationale: `structural coverage failed for ${broken.f}: ${broken.res.reason}` };
    }
    const where = [...new Set(claimants.map((r) => r.file))].join(", ");
    return { ...base, focal_verdict: "pass" as const, rationale: `structural: claim(s) resolve and ${where} mechanically verified (coverage/presence)` };
  });

  const decision = per_triple.some((t) => t.focal_verdict === "fail") ? "reject" : "accept";
  return {
    success: true,
    value: {
      intent_path: intentPath,
      decision,
      per_triple,
      aggregate_rationale: `${decision} — structural (mechanical) verification over ${per_triple.length} triple(s)`,
    },
  };
}

/**
 * Merge a structural and a semantic verdict for a MIXED intent (some triples
 * claimed by sidecars, some by inline `.ts` decoration). A triple claimed BOTH
 * ways must pass BOTH; a structural-only triple takes the structural verdict; a
 * semantic-only triple takes the semantic verdict. Channel honesty is preserved:
 * a both-ways triple reports `semantic` (an LLM did judge part of it).
 */
export function mergeStructuralSemantic(
  structural: Verdict,
  semantic: Verdict,
  structuralIds: Set<string>,
  semanticIds: Set<string>,
): Verdict {
  const sMap = new Map(structural.per_triple.map((t) => [t.triple_id, t]));
  const mMap = new Map(semantic.per_triple.map((t) => [t.triple_id, t]));
  const ids = [...new Set([...sMap.keys(), ...mMap.keys()])];

  const per_triple: PerTripleVerdict[] = ids.map((id) => {
    const s = sMap.get(id);
    const m = mMap.get(id);
    const isStruct = structuralIds.has(id);
    const isSem = semanticIds.has(id);
    if (isStruct && isSem && s && m) {
      const pass = s.focal_verdict === "pass" && m.focal_verdict === "pass";
      return {
        ...m,
        focal_verdict: pass ? "pass" : "fail",
        channel: "semantic",
        rationale: pass
          ? `structural+semantic both pass — ${s.rationale}; ${m.rationale}`
          : `structural=${s.focal_verdict} (${s.rationale}); semantic=${m.focal_verdict} (${m.rationale})`,
      };
    }
    if (isStruct && s) return s;
    if (m) return m;
    return s as PerTripleVerdict;
  });

  const decision = per_triple.some((t) => t.focal_verdict === "fail") ? "reject" : "accept";
  return {
    intent_path: structural.intent_path,
    decision,
    per_triple,
    aggregate_rationale: `${decision} — mixed structural+semantic verification`,
  };
}
