import { z } from "zod";

/**
 * The Recovery-Ladder L2 artifact shape (`.ia/runtime/beads/<bead-id>/intent-proposal.yaml`,
 * Phase 3 §recovery-ladder). Phase 4's `l2_recovery` Author entry mode parses the
 * proposal against this schema before injecting its rephrasings as the Stage-3
 * practice-proposal content (design D6). A malformed/missing file surfaces as
 * `author_l2_proposal_unreadable`.
 */

export const ProposalDiagnosisSchema = z
  .object({
    iter: z.number().int(),
    observation: z.string(),
  })
  .strict();
export type ProposalDiagnosis = z.infer<typeof ProposalDiagnosisSchema>;

export const ProposedRevisionSchema = z
  .object({
    intent: z.string(),
    suggestion: z.string(),
  })
  .strict();
export type ProposedRevision = z.infer<typeof ProposedRevisionSchema>;

export const IntentProposalSchema = z
  .object({
    bead_id: z.string(),
    unsatisfiable_intents: z.array(z.string()),
    diagnoses: z.array(ProposalDiagnosisSchema),
    proposed_revisions: z.array(ProposedRevisionSchema),
  })
  .strict();
export type IntentProposal = z.infer<typeof IntentProposalSchema>;
