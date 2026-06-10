import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDecorations } from "@dusk/core-decoration";
import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import { IntentSchema, type Intent } from "@dusk/core-schema";

/**
 * The RFC Appendix B worked example — the canonical `sendNotification` fixture.
 * Used by the Verifier procedure tests, the MCP read-surface tests, the `dusk
 * verify` CLI test, and the phase-landing smoke test.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "worked-example");

/** The logical path the decorations + index records carry (the verifier's readFile key). */
export const WORKED_EXAMPLE_FILE = "packages/api/src/services/notifications/index.ts";

export const cleanSourcePath = (): string => join(ROOT, "clean", "sendNotification.ts");
export const defectsSourcePath = (): string => join(ROOT, "defects", "sendNotification.ts");

const intent = (raw: Record<string, unknown>): Intent => IntentSchema.parse(raw);

/** The intents in scope for the worked example (RFC App. B.1) + the Phase-2 canonical additions. */
export function workedExampleIntents(): Map<string, Intent> {
  const intents: Intent[] = [
    intent({
      id: "notifications/send",
      description: "Send notifications: persist first, publish one sync event per insert, respect opt-out, clean up stale devices, and never let push failures block persistence.",
      obligation: "must",
      compose: "all",
      triples: [
        { id: "normalize-target", subject: "the function", predicate: "normalizes", object: "the notification target into a uniform user id array" },
        { id: "persist-first", subject: "the notification insert", predicate: "completes before", object: "any sync event is published" },
        {
          id: "publish-sync-per-insert",
          subject: "the publish loop",
          predicate: "emits a SyncEvent on the notification channel",
          object: "for each inserted notification",
          quantifier: "exactly-one",
          scope: "per inserted notification row",
        },
        { id: "respect-opt-out", subject: "the push delivery", predicate: "excludes", object: "users whose pushOptOut preference is true" },
        { id: "cleanup-device-not-registered", subject: "the cleanup step", predicate: "deletes", object: "push tokens whose delivery returned deviceNotRegistered" },
        { id: "persistence-not-blocked-by-push", subject: "a thrown push error", predicate: "is isolated so it does not prevent", object: "the notification persistence from succeeding" },
      ],
    }),
    intent({
      id: "db/use-drizzle-orm",
      description: "Database access uses Drizzle's typed query builder, never raw SQL string templates.",
      obligation: "must",
      compose: "all",
      triples: [
        { id: "typed-queries-only", subject: "the database access", predicate: "uses", object: "Drizzle's typed query builder with values/returning/where" },
        { id: "no-raw-sql", subject: "the service layer", predicate: "constructs queries via", object: "raw SQL string templates", polarity: "negative" },
      ],
    }),
    intent({
      id: "sync/pubsub-on-create",
      description: "Entity creation publishes a sync event per inserted row.",
      obligation: "must",
      compose: "all",
      triples: [{ id: "event-per-insert", subject: "the publish call", predicate: "delivers", object: "a sync event per inserted row onto the resolved channel" }],
    }),
    intent({
      id: "observability/structured-logging",
      description: "Logs carry structured object payloads.",
      obligation: "should",
      compose: "all",
      triples: [{ id: "structured-payloads", subject: "log calls", predicate: "pass", object: "a structured object payload as the first argument" }],
    }),
    intent({
      id: "error-handling/observable-failures",
      description: "Failures are caught, logged, and execution continues without swallowing the signal.",
      obligation: "must",
      compose: "all",
      triples: [{ id: "catch-log-continue", subject: "the catch block", predicate: "logs the error and continues", object: "so the failure is observable and persistence is preserved" }],
    }),
    // Phase-2 canonical addition: compose: implies with a deterministic antecedent.
    intent({
      id: "api/idempotency-on-writes",
      description: "Write endpoints validate and persist an idempotency key.",
      obligation: "must",
      compose: "implies",
      antecedent: [{ id: "is-write", subject: "the endpoint", predicate: "is decorated with", object: "api/write-endpoint" }],
      consequent: [
        { id: "validates-idempotency", subject: "the endpoint", predicate: "validates", object: "an idempotency key on the Idempotency-Key header" },
        { id: "stores-idempotency", subject: "the endpoint", predicate: "persists", object: "the idempotency key and response under a stable lookup" },
      ],
    }),
    // Phase-2 canonical addition: test-pyramid child (unsatisfied until test code exists).
    intent({
      id: "notifications/send/unit-tests",
      description: "Unit tests cover persistence, publish-per-insert, opt-out, stale cleanup, and push-failure isolation.",
      obligation: "must",
      compose: "all",
      triples: [
        { id: "covers-persist-first", subject: "the unit-test suite", predicate: "includes", object: "a case verifying db.insert is called before any pubsub.publish" },
      ],
      relates_to: [{ kind: "parent", target: "notifications/send" }],
    }),
  ];
  return new Map(intents.map((i) => [i.id, i]));
}

export type WorkedExample = {
  source: string;
  file: string;
  index: DerivedIndex;
  intents: Map<string, Intent>;
  readFile: (file: string) => string;
};

export function loadWorkedExample(opts: { variant?: "clean" | "defects" } = {}): WorkedExample {
  const path = opts.variant === "defects" ? defectsSourcePath() : cleanSourcePath();
  const source = readFileSync(path, "utf8");
  const records = parseDecorations(source, WORKED_EXAMPLE_FILE);
  const intents = workedExampleIntents();
  const index = buildDerivedIndex(records, intents);
  const readFile = (file: string): string => (file === WORKED_EXAMPLE_FILE ? source : "");
  return { source, file: WORKED_EXAMPLE_FILE, index, intents, readFile };
}
