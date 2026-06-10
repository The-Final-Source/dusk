import {
  duskError,
  type AuthorGenerateContext,
  type AuthorGeneration,
  type AuthorGenerator,
  type BoundSpawn,
  type DraftIntent,
  type TensionFinding,
  DraftIntentSchema,
  TensionFindingSchema,
} from "@dusk/core-schema";
import { writeBackMemory } from "@dusk/runtime-memory";

/**
 * The production Author generator (task 3.12): one `spawnSubAgent` call per
 * generated turn, through Phase 2's ambient-model path (`role: "author"`,
 * `memory: dialog`, advisory `tools: [Read, Grep]` for the Stage-2 grep). The
 * Author's seven skills are injected by the spawn pipeline from the role file's
 * frontmatter. Stage 3 is training + skill ONLY (RFC §8.11 — no fetch, no
 * canonical-library read); Stage 2 candidates come pre-grepped from the runtime
 * (RFC §8.10 — no vector substrate).
 */

export type ModelGeneratorDeps = {
  rootDir: string;
  sessionId: string;
  spawn: BoundSpawn;
};

const STAGE_INSTRUCTIONS: Record<string, string> = {
  "1": `Stage 1 — Intake & Framing. Restate the user's request as a crisp architectural framing:
what behavior is wanted, in which domain, with what boundaries. End by asking the user to
confirm the framing or correct it.`,
  "2": `Stage 2 — Discovery & Tension Detection. You are given grep candidates from the existing
intent tree. Classify each candidate's tension with the new request as one of
conflict | overlap | gray | adjacent, and propose resolution options per tension. If a candidate
is unrelated, omit it.`,
  "3": `Stage 3 — Industry-Practice Injection. From your training knowledge ONLY (no lookups),
propose a decomposition reflecting industry practice for this domain. Present it as a proposal
the user can accept, reject (greenfield), or selectively accept.`,
  "4": `Stage 4 — Drafting. Draft the intent(s) as schema-v2 objects. RULES:
- Triple slots are ALWAYS affirmative; negative meaning is expressed as polarity: "negative" — never a negated predicate.
- Conditional rules use compose: "implies" with antecedent predicates ONLY from: "is decorated with", "claims any aspect of", "is enclosed by a decoration of"; antecedent objects must be resolvable intent paths/globs.
- relates_to kinds are ONLY: parent | implies | conflicts | supersedes | sibling. Never "refines".
- For an implementation intent, propose test-pyramid children (unit-tests / integration-tests / e2e-tests) and ask the user to pick a subset (reply with payload.layers).`,
};

function jsonContract(stage: string): string {
  const base = `Respond with EXACTLY one JSON object (no markdown fences) of the shape:
{"question": "<the next question to ask the user>"`;
  if (stage === "2") return `${base}, "tensions": [{"target": "<intent path>", "classification": "conflict|overlap|gray|adjacent", "excerpt": "<why>", "resolution_options": ["..."]}]}`;
  if (stage === "3") return `${base}, "practiceProposal": "<the full practice proposal text>"}`;
  if (stage === "4") return `${base}, "draftPatch": {<the drafted intent>}, "drafts": [{<additional drafted intents>}]}`;
  return `${base}}`;
}

function extractJson(output: string): Record<string, unknown> | null {
  const start = output.indexOf("{");
  if (start === -1) return null;
  for (let end = output.length; end > start; end -= 1) {
    const candidate = output.slice(start, end);
    if (!candidate.endsWith("}")) continue;
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}

const transcriptBlock = (ctx: AuthorGenerateContext): string =>
  ctx.state.transcript.map((t) => `[${t.role} @ stage ${t.stage}]\n${t.content}`).join("\n\n");

export function makeModelAuthorGenerator(deps: ModelGeneratorDeps): AuthorGenerator {
  return async (ctx) => {
    const stageKey = String(ctx.stage === "4.5" ? 4 : ctx.stage);
    const input = [
      STAGE_INSTRUCTIONS[stageKey] ?? STAGE_INSTRUCTIONS["4"],
      "",
      `## Original request`,
      ctx.state.request,
      "",
      `## Dialog so far`,
      transcriptBlock(ctx) || "(none)",
      "",
      `## Drafted so far`,
      JSON.stringify(ctx.state.intents_drafted, null, 2),
      "",
      ctx.context ? `## Stage context\n${JSON.stringify(ctx.context, null, 2)}\n` : "",
      jsonContract(stageKey),
    ].join("\n");

    // Wire the `dialog` memory materializer: persist the negotiation so the next
    // spawn for this dialog_id materializes it (Phase 2 four-scope contract).
    writeBackMemory({
      rootDir: deps.rootDir,
      scope: "dialog",
      role: "author",
      content: transcriptBlock(ctx) || "(none)",
      ids: { dialogId: ctx.state.dialog_id },
    });

    const spawned = await deps.spawn({
      role: "author",
      sessionId: deps.sessionId,
      dialogId: ctx.state.dialog_id,
      input,
      invocationSite: "author",
    });
    if (!spawned.success) return spawned.error;

    const parsed = extractJson(spawned.value.output ?? "");
    if (!parsed || typeof parsed.question !== "string") {
      return duskError("internal_error", "the Author model returned no parseable generation JSON", {
        recoverable: true,
        details: { stage: ctx.stage, output_head: (spawned.value.output ?? "").slice(0, 200) },
      });
    }

    const generation: AuthorGeneration = { question: parsed.question };
    try {
      if (parsed.draftPatch !== undefined) generation.draftPatch = DraftIntentSchema.parse(parsed.draftPatch) as DraftIntent;
      if (Array.isArray(parsed.drafts)) generation.drafts = parsed.drafts.map((d) => DraftIntentSchema.parse(d) as DraftIntent);
      if (Array.isArray(parsed.tensions)) generation.tensions = parsed.tensions.map((t) => TensionFindingSchema.parse(t) as TensionFinding);
      if (typeof parsed.practiceProposal === "string") generation.practiceProposal = parsed.practiceProposal;
    } catch (error) {
      return duskError("internal_error", `the Author model's generation failed draft-schema validation: ${(error as Error).message}`, {
        recoverable: true,
        details: { stage: ctx.stage },
      });
    }
    return generation;
  };
}
