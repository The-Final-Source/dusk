import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { commitBead, type CommitResult, type GitRunner } from "@dusk/runtime-commit";
import { duskError, ok, type CommitTrailers, type DuskError, type RuntimeResult } from "@dusk/core-schema";
import { stringify as yamlStringify } from "yaml";

/**
 * The four recovery-ladder actions (RFC §6.4.1; design D3). L1 ships satisfiable
 * intents + defers the rest (Partial commit + deferred.yaml). L2 writes a
 * recoverable intent-modification proposal. L3 freezes operator-actionably
 * (worktree preserved + freeze-state.md). L4 hard-aborts (only when freeze can't
 * serialize). Artifacts live under `.ia/runtime/beads/<bead-id>/`.
 */

export const beadDir = (rootDir: string, beadId: string): string => join(rootDir, ".ia/runtime/beads", beadId);

export type DiagnosisEntry = { iter: number; text: string };
export type VerdictSummary = { iter: number; decision: string; triple_id: string; rationale: string };

// ---- L1: partial commit ----------------------------------------------------

export type Level1Input = {
  rootDir: string;
  beadId: string;
  worktreePath: string;
  satisfiedIntents: string[];
  deferredIntents: string[];
  /** Base trailers; L1 stamps `partial: true` + `deferred_intents`. */
  trailers: CommitTrailers;
  subject: string;
  body?: string;
  gitRunner?: GitRunner;
};

export type Level1Outcome = { level: "L1"; commit: CommitResult; deferred: string[] };

/** Write deferred.yaml and produce the single Partial commit. */
export function level1PartialCommit(input: Level1Input): RuntimeResult<Level1Outcome> {
  const deferredPath = join(beadDir(input.rootDir, input.beadId), "deferred.yaml");
  mkdirSync(dirname(deferredPath), { recursive: true });
  writeFileSync(deferredPath, yamlStringify({ bead_id: input.beadId, deferred_intents: input.deferredIntents }), "utf8");

  const trailers: CommitTrailers = {
    ...input.trailers,
    intents: input.trailers.intents.filter((i) => input.satisfiedIntents.includes(i.intent_path)),
    partial: true,
    deferred_intents: input.deferredIntents,
  };
  const commit = commitBead({
    worktreePath: input.worktreePath,
    subject: input.subject,
    body: input.body,
    trailers,
    gitRunner: input.gitRunner,
  });
  if (!commit.success) return commit;
  return ok({ level: "L1", commit: commit.value, deferred: input.deferredIntents });
}

// ---- L2: intent-modification proposal --------------------------------------

export type Level2Input = {
  rootDir: string;
  beadId: string;
  /** ALL lifetime diagnoses (aggregated, not just the last). */
  diagnosisHistory: DiagnosisEntry[];
  unsatisfiableIntents: string[];
};

export type Level2Outcome = { level: "L2"; error: DuskError; proposalPath: string };

export function level2Proposal(input: Level2Input): Level2Outcome {
  const proposalPath = join(beadDir(input.rootDir, input.beadId), "intent-proposal.yaml");
  mkdirSync(dirname(proposalPath), { recursive: true });
  writeFileSync(
    proposalPath,
    yamlStringify({
      bead_id: input.beadId,
      unsatisfiable_intents: input.unsatisfiableIntents,
      // Aggregate EVERY lifetime diagnosis (design D3).
      diagnoses: input.diagnosisHistory.map((d) => ({ iter: d.iter, observation: d.text })),
      proposed_revisions: input.unsatisfiableIntents.map((intent) => ({
        intent,
        suggestion: "review the aggregated diagnoses and rephrase the failing triple affirmatively or narrow its scope",
      })),
    }),
    "utf8",
  );
  return {
    level: "L2",
    proposalPath,
    error: duskError("bead_intent_revision_needed", `bead ${input.beadId} could not satisfy its intents; a revision proposal was written`, {
      recoverable: true,
      bead_id: input.beadId,
      step: 4,
      details: { proposal_path: proposalPath, unsatisfiable_intents: input.unsatisfiableIntents },
      recovery_hint: `review .ia/runtime/beads/${input.beadId}/intent-proposal.yaml, then dusk_author_continue to revise the intents`,
    }),
  };
}

// ---- L3: operator-actionable freeze ----------------------------------------

/**
 * Machine-readable resume record persisted alongside the human-readable
 * freeze-state.md, so `dusk implement --resume <bead-id>` can reload the frozen
 * bead and continue its Step-4 entry from the right iteration (§recovery-ladder).
 */
export type FreezeResumeState = {
  bead_id: string;
  intent_paths: string[];
  /** Lifetime iterations already consumed (resume continues from here). */
  lifetime_iter: number;
  branch: string;
};

export type Level3Input = {
  rootDir: string;
  beadId: string;
  beadMemory: string;
  lastVerdicts: VerdictSummary[];
  diagnosisHistory: DiagnosisEntry[];
  /** Resume record written to freeze-state.json (enables the documented resume). */
  resume?: FreezeResumeState;
  /** Injectable writer so tests can force a serialization failure (→ L4). */
  freezeWriter?: (path: string, content: string) => void;
};

export type Level3Outcome = { level: "L3"; error: DuskError; freezePath: string; resumePath?: string };

export const freezeResumePath = (rootDir: string, beadId: string): string => join(beadDir(rootDir, beadId), "freeze-state.json");

const defaultFreezeWriter = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
};

/** Write freeze-state.md; THROWS if serialization fails (the caller falls to L4). */
export function level3Freeze(input: Level3Input): Level3Outcome {
  const freezePath = join(beadDir(input.rootDir, input.beadId), "freeze-state.md");
  const content = [
    `# Frozen bead ${input.beadId}`,
    "",
    "## Bead memory",
    input.beadMemory.trim().length > 0 ? input.beadMemory.trim() : "(none)",
    "",
    "## Last 3 verdicts",
    input.lastVerdicts.length === 0
      ? "(none)"
      : input.lastVerdicts.map((v) => `- [iter ${v.iter}] ${v.decision} — ${v.triple_id}: ${v.rationale}`).join("\n"),
    "",
    "## Diagnosis history",
    input.diagnosisHistory.length === 0
      ? "(none)"
      : input.diagnosisHistory.map((d) => `- [iter ${d.iter}] ${d.text}`).join("\n"),
    "",
  ].join("\n");

  const write = input.freezeWriter ?? defaultFreezeWriter;
  write(freezePath, content); // may throw → L4
  let resumePath: string | undefined;
  if (input.resume) {
    resumePath = freezeResumePath(input.rootDir, input.beadId);
    write(resumePath, JSON.stringify(input.resume, null, 2));
  }
  return {
    level: "L3",
    freezePath,
    ...(resumePath ? { resumePath } : {}),
    error: duskError("bead_frozen", `bead ${input.beadId} frozen for operator resolution; worktree preserved`, {
      recoverable: false,
      bead_id: input.beadId,
      step: 4,
      details: { freeze_path: freezePath },
      recovery_hint: `inspect ${freezePath}, then \`dusk implement --resume ${input.beadId}\``,
    }),
  };
}

// ---- L4: hard abort --------------------------------------------------------

export type Level4Outcome = { level: "L4"; error: DuskError };

export function level4Abort(beadId: string, cause: string): Level4Outcome {
  return {
    level: "L4",
    error: duskError("bead_aborted", `bead ${beadId} aborted: ${cause}`, {
      recoverable: false,
      bead_id: beadId,
      step: 4,
    }),
  };
}
