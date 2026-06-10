/**
 * The recovery-ladder decision function (RFC §6.4.1; design D3; 7.1). A PURE
 * transform invoked when the 40-iter lifetime budget exhausts. The cascade:
 *
 *   L1 if  canPartialCommit                                   (≥1 satisfied ∧ partial-commit valid)
 *   L2 if  ¬canPartialCommit ∧ proposalGenerationSucceeds
 *   L3 if  ¬canPartialCommit ∧ ¬proposalGenerationSucceeds ∧ freezeWritable
 *   L4 otherwise                                              (freeze cannot serialize)
 *
 * `canPartialCommit` folds the design's `(≥1 satisfied) ∧ partial_commit_valid`
 * into one boolean, giving the 2^3 = 8-combination input space the test
 * enumerates. The CRITICAL round-4 fix: L4 fires ONLY when freeze cannot
 * serialize — a zero-satisfiable bead (¬canPartialCommit) with a generable
 * proposal emits L2 (recoverable), NEVER L4.
 */

export const LADDER_LEVELS = ["L1", "L2", "L3", "L4"] as const;
export type LadderLevel = (typeof LADDER_LEVELS)[number];

export type LadderInputs = {
  /** ≥1 intent satisfied AND a clean partial commit is possible. */
  canPartialCommit: boolean;
  /** The L2 intent-modification proposal could be generated. */
  proposalGenerationSucceeds: boolean;
  /** The L3 freeze state could be serialized to disk. */
  freezeWritable: boolean;
};

export function decideLadderLevel(inputs: LadderInputs): LadderLevel {
  if (inputs.canPartialCommit) return "L1";
  if (inputs.proposalGenerationSucceeds) return "L2";
  if (inputs.freezeWritable) return "L3";
  return "L4";
}
