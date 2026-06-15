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
intent tree and an "intent_census" (every intent path currently in the tree, and whether it is
empty). Tension detection runs in BOTH directions:
(a) against intents that EXIST — classify each candidate's tension with the request as
    conflict | overlap | gray | adjacent (omit unrelated candidates); and
(b) against an intent the request DEPENDS ON but that does NOT exist in the census — surface a
    "prerequisite" tension: target = the missing intent's proposed path, excerpt = what the
    request presupposes, resolution_options = e.g. "author <prerequisite> first, then return" /
    "proceed (author the prerequisite separately)".
A prerequisite tension is general — it applies to ANY unmet dependency. The most common instance
is a greenfield project whose foundation is not yet authored (an empty or near-empty census):
project/tech-stack setup, module structure, app bootstrap, the persistence layer. Do NOT silently
draft a behavior intent that depends on intents absent from the census; surface the prerequisite
so the user can author the dependency first. Emit at least one "prerequisite" tension when the
request plainly depends on something the census lacks.`,
  "3": `Stage 3 — Industry-Practice Injection. From your training knowledge ONLY (no lookups),
propose a decomposition reflecting industry practice for this domain. Present it as a proposal
the user can accept, reject (greenfield), or selectively accept.`,
  "4": `Stage 4 — Drafting. Draft the intent(s) as schema-v2 objects in draftPatch (and drafts[] for additional intents such as a conditional companion). RULES:
- Every intent needs: id (slash-namespaced lowercase path, e.g. "api/no-offset-pagination"), description, obligation ("must"|"should"|"may"), and either triples[] (compose "all") or antecedent[]+consequent[] (compose "implies").
- Every triple needs: id (lowercase-kebab), subject, predicate, object. Slots are ALWAYS affirmative; negative meaning is expressed as polarity: "negative" on the triple — NEVER a negated predicate (no "does not", "never", "lacks", …).
- Conditional rules use compose: "implies" with antecedent predicates ONLY from: "is decorated with", "claims any aspect of", "is enclosed by a decoration of"; antecedent objects must be resolvable intent paths/globs (e.g. "api/write-endpoint"). Consequent triples use normal free predicates.
- relates_to kinds are ONLY: parent | implies | conflicts | supersedes | sibling. Never "refines".
- Do NOT draft test-pyramid children yourself — the runtime derives them mechanically. Your question should ask the user to pick layers (they reply with payload.layers).`,
};

function jsonContract(stage: string): string {
  const base = `Respond with EXACTLY one JSON object (no markdown fences) of the shape:
{"question": "<the next question to ask the user>"`;
  if (stage === "2") return `${base}, "tensions": [{"target": "<intent path or proposed path of a missing prerequisite>", "classification": "conflict|overlap|gray|adjacent|prerequisite", "excerpt": "<why>", "resolution_options": ["..."]}]}`;
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

    // The model occasionally emits prose around (or instead of) the JSON envelope
    // — a recoverable formatting flake, not a logic error. Retry the spawn+parse
    // ONCE before failing (mirrors the implement Verifier's one-retry on a
    // non-JSON response; the real-model parse-flake the greenfield dialog hit).
    let parsed: Record<string, unknown> | null = null;
    let outputHead = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const spawned = await deps.spawn({
        role: "author",
        sessionId: deps.sessionId,
        dialogId: ctx.state.dialog_id,
        input,
        invocationSite: "author",
      });
      if (!spawned.success) return spawned.error;
      outputHead = (spawned.value.output ?? "").slice(0, 200);
      parsed = extractJson(spawned.value.output ?? "");
      if (parsed && typeof parsed.question === "string") break;
      parsed = null;
    }
    if (!parsed || typeof parsed.question !== "string") {
      return duskError("internal_error", "the Author model returned no parseable generation JSON after one retry", {
        recoverable: true,
        details: { stage: ctx.stage, output_head: outputHead },
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
