import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Stalling-fixture builder (task 1.3c) — writes an intent the Engineer cannot
 * satisfy across N drafts, used by P3-T8's integration leg (§6.4). The intent
 * carries two genuinely-contradictory triples (synchronous return vs. an awaited
 * network call), so AT LEAST ONE focal triple keeps failing no matter what the
 * Engineer drafts — producing a STABLE `failing_triple_set` across iterations,
 * which is exactly the upstream signal the stuckness detector keys on.
 */

export type StallingFixture = {
  /** The intent path (= id), e.g. `stall/contradiction`. */
  intentPath: string;
  /** Absolute path of the written intent.yaml. */
  intentFile: string;
  /** Absolute path of the written, decorated source file. */
  sourceFile: string;
  /** The intent's triple ids (the failing-triple set will be a non-empty subset). */
  tripleIds: string[];
};

export type StallingFixtureOptions = {
  intentPath?: string;
  intentsDir?: string;
  sourceRelPath?: string;
};

export function writeStallingFixture(repoDir: string, options: StallingFixtureOptions = {}): StallingFixture {
  const intentPath = options.intentPath ?? "stall/contradiction";
  const intentsDir = options.intentsDir ?? ".ia/intents";
  const sourceRel = options.sourceRelPath ?? "src/stall.ts";
  const tripleIds = ["returns-synchronously", "awaits-network-first"];

  const intentYaml = `schema_version: 2
id: ${intentPath}
description: A deliberately self-contradictory intent (no draft can satisfy both triples).
obligation: must
compose: all
triples:
  - id: ${tripleIds[0]}
    subject: the resolve function
    predicate: return
    object: its value synchronously without awaiting anything
  - id: ${tripleIds[1]}
    subject: the resolve function
    predicate: await
    object: a network round-trip before it returns any value
`;

  const source = `// @intent ${intentPath} [${tripleIds.join(", ")}]
export function resolve() {
  return 0;
}
`;

  const intentFile = join(repoDir, intentsDir, intentPath, "intent.yaml");
  const sourceFile = join(repoDir, sourceRel);
  mkdirSync(dirname(intentFile), { recursive: true });
  mkdirSync(dirname(sourceFile), { recursive: true });
  writeFileSync(intentFile, intentYaml, "utf8");
  writeFileSync(sourceFile, source, "utf8");

  return { intentPath, intentFile, sourceFile, tripleIds };
}
