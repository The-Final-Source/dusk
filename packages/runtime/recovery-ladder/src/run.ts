import { ok, type CommitTrailers, type RuntimeResult } from "@dusk/core-schema";
import type { GitRunner } from "@dusk/runtime-commit";

import {
  level1PartialCommit,
  level2Proposal,
  level3Freeze,
  level4Abort,
  type DiagnosisEntry,
  type Level1Outcome,
  type Level2Outcome,
  type Level3Outcome,
  type Level4Outcome,
  type VerdictSummary,
} from "./actions.js";
import { decideLadderLevel } from "./decision.js";

/**
 * Run the recovery ladder when the lifetime budget exhausts (RFC §6.4.1). The
 * pure {@link decideLadderLevel} picks the level; the runner executes the action.
 * The CRITICAL semantics: L4 fires ONLY when the L3 freeze write throws (disk
 * error) — a zero-satisfiable bead with a generable proposal yields L2, not L4.
 */

export type RecoveryOutcome = Level1Outcome | Level2Outcome | Level3Outcome | Level4Outcome;

export type RecoveryLadderInput = {
  rootDir: string;
  beadId: string;
  worktreePath: string;
  satisfiedIntents: string[];
  deferredIntents: string[];
  diagnosisHistory: DiagnosisEntry[];
  lastVerdicts: VerdictSummary[];
  beadMemory: string;
  trailers: CommitTrailers;
  subject: string;
  body?: string;
  /** Whether a clean partial commit is possible (default: ≥1 satisfied intent). */
  partialCommitValid?: boolean;
  /** Force the L2 proposal step to be unavailable (drives the L3/L4 branch in tests). */
  proposalGenerationSucceeds?: boolean;
  gitRunner?: GitRunner;
  /** Injectable freeze writer; throwing drives L4 (disk-error injection). */
  freezeWriter?: (path: string, content: string) => void;
};

export function runRecoveryLadder(input: RecoveryLadderInput): RuntimeResult<RecoveryOutcome> {
  const canPartialCommit = (input.partialCommitValid ?? input.satisfiedIntents.length > 0) && input.satisfiedIntents.length > 0;
  const proposalGenerationSucceeds = input.proposalGenerationSucceeds ?? true;

  // The pure decision picks the level; for L3 we additionally honor a freeze
  // write failure by cascading to L4 (the only L4 trigger).
  const level = decideLadderLevel({ canPartialCommit, proposalGenerationSucceeds, freezeWritable: true });

  if (level === "L1") {
    // A git failure during the partial commit is a genuine infrastructure error.
    return level1PartialCommit({
      rootDir: input.rootDir,
      beadId: input.beadId,
      worktreePath: input.worktreePath,
      satisfiedIntents: input.satisfiedIntents,
      deferredIntents: input.deferredIntents,
      trailers: input.trailers,
      subject: input.subject,
      body: input.body,
      gitRunner: input.gitRunner,
    });
  }

  if (level === "L2") {
    return ok(
      level2Proposal({
        rootDir: input.rootDir,
        beadId: input.beadId,
        diagnosisHistory: input.diagnosisHistory,
        unsatisfiableIntents: input.deferredIntents,
      }),
    );
  }

  // level === "L3" (¬L1 ∧ ¬proposalGenerationSucceeds): attempt the freeze; a
  // serialization failure cascades to L4 (the corrected round-4 trigger).
  try {
    return ok(
      level3Freeze({
        rootDir: input.rootDir,
        beadId: input.beadId,
        beadMemory: input.beadMemory,
        lastVerdicts: input.lastVerdicts,
        diagnosisHistory: input.diagnosisHistory,
        freezeWriter: input.freezeWriter,
      }),
    );
  } catch (error) {
    return ok(level4Abort(input.beadId, error instanceof Error ? error.message : "freeze-state serialization failed"));
  }
}
