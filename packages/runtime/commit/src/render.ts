import type { CommitTrailers } from "@dusk/core-schema";

/**
 * Step-7 commit-message assembly (RFC §6.7, App. A.7; design D10). Conventional
 * Commits subject + optional body + the full v9 trailer set in the FIXED App. A.7
 * order. Conditional trailers (`Partial`, `Deferred-Intent`,
 * `Verifier-bypassed-test-intent`) are emitted ONLY when present on the structure
 * (i.e. produced via their gated paths).
 */

export function renderTrailers(t: CommitTrailers): string[] {
  const lines: string[] = [];
  for (const intent of t.intents) {
    const aspects = intent.aspect_ids.length > 0 ? ` [${intent.aspect_ids.join(", ")}]` : "";
    lines.push(`Intent: ${intent.intent_path}${aspects}`);
  }
  for (const ti of t.test_intents) lines.push(`Test-Intent: ${ti}`);
  lines.push(`Bead-id: ${t.bead_id}`);
  lines.push(`Verdict-id: ${t.verdict_id}`);
  if (t.test_verdict_id) lines.push(`Test-Verdict-id: ${t.test_verdict_id}`);
  lines.push(`Trace-id: ${t.trace_id}`);
  lines.push(`Verifier-model: ${t.verifier_model}`);
  if (t.test_runner_model) lines.push(`Test-Runner-model: ${t.test_runner_model}`);
  lines.push(`Long-cycle-samples: ${t.long_cycle_samples}`);
  lines.push(`Test-Suites-passed: ${t.test_suites_passed}`);
  // Conditional section (gated paths only).
  if (t.partial) lines.push(`Partial: true`);
  for (const deferred of t.deferred_intents ?? []) lines.push(`Deferred-Intent: ${deferred}`);
  for (const bypassed of t.verifier_bypassed_test_intents ?? [])
    lines.push(`Verifier-bypassed-test-intent: ${bypassed.test_intent_path}[${bypassed.triple_id}]`);
  return lines;
}

export type CommitMessageInput = {
  subject: string;
  body?: string;
  trailers: CommitTrailers;
};

/** Full commit message: `subject\n\n[body\n\n]<trailers>`. */
export function renderCommitMessage(input: CommitMessageInput): string {
  const parts = [input.subject];
  if (input.body && input.body.trim().length > 0) parts.push(input.body.trim());
  parts.push(renderTrailers(input.trailers).join("\n"));
  return parts.join("\n\n");
}
