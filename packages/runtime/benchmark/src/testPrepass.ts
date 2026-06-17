import type { DerivedIndex } from "@dusk/core-index";
import { duskError, type Intent, type RuntimeResult, type Verdict, type VerifierFactory } from "@dusk/core-schema";
import type { ModelClient } from "@dusk/runtime-verifier";

/**
 * The REAL Stage-1 test-body pre-pass (RFC §3.4 two-stage test satisfaction) —
 * the Verifier judges whether a test body GENUINELY verifies its claimed
 * triples before any runtime execution. The mechanism (rejected tests never
 * reach Vitest; the bead re-enters Step 4) shipped and was gated in Phase 3
 * with the scripted double; this is the real-model instrument the Phase-5
 * benchmark measures with (P5-T9 two-stage leg).
 */

export const TEST_PREPASS_SYSTEM_PROMPT =
  "You are a Dusk Verifier performing the Stage-1 test-body pre-pass (RFC §3.4). Judge whether each claimed " +
  "test triple is GENUINELY verified by the test body: the test must be able to FAIL when the claimed behavior " +
  "is wrong, and its assertion must consume a value actually DERIVED FROM the unit under test (its return value " +
  "or observable effects). Tautological assertions, assertions on constants or fixture inputs that merely invoke " +
  "the unit without checking its output, assertions on mocks or stubs instead of the unit, type-only or " +
  "no-throw-only checks, swallowed failures, mirror re-implementations of the unit, empty suites, and assertions " +
  "behind unreachable guards do NOT genuinely verify. Answer only with the requested JSON.";

type PrepassAnswer = { triples: Array<{ triple_id: string; genuinely_verifies: boolean; rationale: string }> };

function parseAnswer(text: string): PrepassAnswer | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as PrepassAnswer;
    return Array.isArray(parsed.triples) ? parsed : null;
  } catch {
    return null;
  }
}

export type TestPrepassDeps = {
  index: DerivedIndex;
  intents: Map<string, Intent>;
  readFile: (file: string) => string;
  modelClient: ModelClient;
};

/** Run the pre-pass for one test intent: every claimed test file's body is judged against the intent's triples. */
export async function realTestPrepassVerdict(intentPath: string, deps: TestPrepassDeps): Promise<RuntimeResult<Verdict>> {
  const intent = deps.intents.get(intentPath);
  if (!intent) {
    return { success: false, error: duskError("intent_path_unresolved", `test intent not found: ${intentPath}`, { recoverable: true }) };
  }
  const claims = deps.index.testDiscovery(intentPath);
  // Fail loud + legible on a missing body (RFC App. D.32, design D3). The intent
  // routed here by its authored suffix (D1), but no `@intent-test`/
  // `@intent-test-file` marker locates the test body — so there is nothing for
  // the pre-pass to judge. An empty body sent to the model could still come back
  // `genuinely_verifies: true` → a silent accept; so this guard MUST pre-empt the
  // model call, not rely on its verdict. Recoverable, so the short cycle can
  // self-correct by adding the test marker.
  if (claims.length === 0) {
    return {
      success: false,
      error: duskError(
        "test_intent_no_test_marker",
        `test intent '${intentPath}' has no test-body marker: decorate the test file's body with @intent-test-file ${intentPath} (file scope) or @intent-test (declaration scope), never @intent`,
        { recoverable: true, details: { intent_path: intentPath, expected_markers: ["intent-test", "intent-test-file"] } },
      ),
    };
  }
  const files = [...new Set(claims.map((c) => c.file))].sort();
  const triples = intent.triples ?? [];

  const user = [
    `Test intent: ${intentPath}`,
    "Claimed triples:",
    ...triples.map((t) => `- ${t.id}: ${t.subject} ${t.predicate} ${t.object}`),
    "",
    ...files.flatMap((file) => [`Test file ${file}:`, "```ts", deps.readFile(file), "```", ""]),
    'Answer with JSON only: {"triples": [{"triple_id": "<id>", "genuinely_verifies": true|false, "rationale": "<one sentence citing the decisive test line>"}]}',
  ].join("\n");

  const completion = await deps.modelClient.complete({ system: TEST_PREPASS_SYSTEM_PROMPT, user, temperature: 0 });
  const parsed = parseAnswer(completion.text);
  if (!parsed) {
    return { success: false, error: duskError("verifier_model_call_failed", "test pre-pass response was not parseable JSON", { recoverable: true }) };
  }

  const perTriple = triples.map((t) => {
    const answer = parsed.triples.find((a) => a.triple_id === t.id);
    const verifies = answer?.genuinely_verifies ?? false;
    return {
      triple_id: t.id,
      focal_verdict: (verifies ? "pass" : "fail") as "pass" | "fail",
      support_quality: "ok" as const,
      polarity: t.polarity,
      evidence: { support_claims: [] },
      rationale: answer?.rationale ?? "no judgment returned for this triple",
    };
  });
  const decision = perTriple.some((t) => t.focal_verdict === "fail") ? "reject" : "accept";
  return {
    success: true,
    value: {
      intent_path: intentPath,
      decision,
      per_triple: perTriple,
      aggregate_rationale: `${decision} — test-body pre-pass over ${files.join(", ")}`,
    },
  };
}

/** A VerifierFactory adapter so the REAL runTestRunner can drive the pre-pass (P5-T9 routing). */
export function realTestPrepassFactory(deps: TestPrepassDeps): VerifierFactory {
  return async (ctx) => {
    const result = await realTestPrepassVerdict(ctx.intentPath, deps);
    return result.success ? result.value : result.error;
  };
}
