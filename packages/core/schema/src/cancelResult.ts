import { z } from "zod";

/**
 * `dusk_cancel` result — RFC App. A.11; design D9, D14. Cleanly partitions work
 * into `cancelled` (reaped) vs `preserved` (kept for user decision / already
 * landed). Frozen here so Phase 5's audit reads it. Cooperative-drain honesty:
 * `in_flight_tasks_drained` counts Task calls that ran to natural completion
 * (no abort primitive exists).
 */

export const PartialCommitSchema = z
  .object({
    bead_id: z.string(),
    branch: z.string(),
    commit_sha: z.string(),
  })
  .strict();
export type PartialCommit = z.infer<typeof PartialCommitSchema>;

export const AlreadyCommittedSchema = z
  .object({
    bead_id: z.string(),
    commit_sha: z.string(),
  })
  .strict();
export type AlreadyCommitted = z.infer<typeof AlreadyCommittedSchema>;

export const CancelResultSchema = z
  .object({
    cancelled: z
      .object({
        cancelled_worktrees: z.array(z.string()),
        partial_commits: z.array(PartialCommitSchema),
        cancelled_dialogs: z.array(z.string()),
        cancelled_checkpoints: z.array(z.string()),
        bead_memories_deleted: z.array(z.string()),
      })
      .strict(),
    preserved: z
      .object({
        already_committed: z.array(AlreadyCommittedSchema),
        in_flight_tasks_drained: z.number().int().min(0),
      })
      .strict(),
    trace_id: z.string(),
    drain_duration_ms: z.number().min(0),
  })
  .strict();
export type CancelResult = z.infer<typeof CancelResultSchema>;
