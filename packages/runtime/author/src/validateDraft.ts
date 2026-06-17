import type { DraftIntent, Intent } from "@dusk/core-schema";
import {
  validateAntecedentGrammar,
  validateAtomicIntent,
  validateMatrixPredicateNegation,
  validateRelatesToKinds,
  validateVerifyChannel,
} from "@dusk/core-parser";

/**
 * Stage 4.5 — the synchronous pre-commit validation pass (design D3). Every rule
 * is the Phase-1 parser primitive imported DIRECTLY from `@dusk/core-parser`;
 * nothing is reimplemented here, so drift between the Author and the PreToolUse
 * gate is structurally impossible. A violation carries the skill-name hint the
 * bounce question surfaces.
 */

export type DraftViolation = {
  code: string;
  draft_id: string;
  path: string;
  message: string;
  skill_hint: "polarity-decision" | "implies-antecedent-grammar" | "typed-relates-to" | "verify-channel" | null;
};

const BOOKKEEPING_KEYS = [
  "tensions_surfaced",
  "tension_resolutions",
  "practice_scaffold",
  "pyramid_picked",
  "reciprocal_resolved",
  "in_place_edit",
] as const;

/** Strip Author bookkeeping and apply v2 defaults: the raw object Stage 5 writes. */
export function toIntentRaw(draft: DraftIntent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if ((BOOKKEEPING_KEYS as readonly string[]).includes(key)) continue;
    if (value !== undefined) out[key] = value;
  }
  if (out.schema_version === undefined) out.schema_version = 2;
  if (out.compose === undefined) out.compose = "all";
  if (out.relates_to === undefined) out.relates_to = [];
  return out;
}

function hintForMessage(message: string): DraftViolation["skill_hint"] {
  const lower = message.toLowerCase();
  if (lower.includes("negation") || lower.includes("polarity")) return "polarity-decision";
  if (lower.includes("antecedent")) return "implies-antecedent-grammar";
  if (lower.includes("relates_to")) return "typed-relates-to";
  return null;
}

/** Validate one draft against the four Phase-1 primitives. Returns violations in rule order. */
export function validateDraft(draft: DraftIntent): DraftViolation[] {
  const draftId = draft.id ?? "(draft)";
  const out: DraftViolation[] = [];

  // 1 — matrix-predicate negation over every drafted triple (RFC §3.1.1).
  for (const triple of [...(draft.triples ?? []), ...(draft.consequent ?? [])]) {
    for (const v of validateMatrixPredicateNegation(triple)) {
      out.push({ code: v.code, draft_id: draftId, path: v.path, message: v.message, skill_hint: "polarity-decision" });
    }
  }

  // 2 — closed-vocabulary antecedent grammar for `compose: implies` (RFC §3.2.1).
  for (const v of validateAntecedentGrammar(draft)) {
    out.push({ code: v.code, draft_id: draftId, path: v.path, message: v.message, skill_hint: "implies-antecedent-grammar" });
  }

  // 3 — five typed relates_to kinds, never `refines` (RFC §2.1).
  for (const v of validateRelatesToKinds(draft)) {
    out.push({ code: v.code, draft_id: draftId, path: v.path, message: v.message, skill_hint: "typed-relates-to" });
  }

  // 4 — verification-channel honesty: structural can verify neither an absence
  //     (negative polarity) nor a cardinality bound (quantifier) (RFC App. D.31).
  for (const triple of [...(draft.triples ?? []), ...(draft.consequent ?? [])]) {
    for (const v of validateVerifyChannel(triple)) {
      out.push({ code: v.code, draft_id: draftId, path: v.path, message: v.message, skill_hint: "verify-channel" });
    }
  }

  if (out.length > 0) return out;

  // 4 — full v2 schema validation. In-place triple edits validate the MERGED file
  //     at finalize (the draft alone is a fragment by design).
  if (draft.in_place_edit) return out;
  const loaded = validateAtomicIntent(toIntentRaw(draft));
  if (!loaded.success) {
    for (const error of loaded.errors) {
      out.push({
        code: "kind" in error ? error.kind : "schema_invalid",
        draft_id: draftId,
        path: error.path,
        message: error.message,
        skill_hint: hintForMessage(error.message),
      });
    }
  }
  return out;
}

/** Validate the full drafted set; Stage 5 never sees a non-validating intent. */
export function validateDrafts(drafts: DraftIntent[]): DraftViolation[] {
  return drafts.flatMap((d) => validateDraft(d));
}

/** Parse a clean draft into a full `Intent` (post-4.5; used by Stage-5 finalize). */
export function draftToIntent(draft: DraftIntent): Intent | null {
  const loaded = validateAtomicIntent(toIntentRaw(draft));
  return loaded.success ? loaded.intent : null;
}
