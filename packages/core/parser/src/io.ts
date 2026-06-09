import { readFileSync, writeFileSync, renameSync } from "node:fs";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AntecedentTriple, Intent, Triple } from "@dusk/core-schema";

import { loadIntent, type IntentLoadResult } from "./loadIntent.js";

/** Write atomically: write a temp sibling then rename over the target (POSIX-atomic). */
export function atomicWriteFile(filePath: string, content: string): void {
  const temp = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, filePath);
}

export function readIntentFile(filePath: string, expectedId?: string): IntentLoadResult {
  const text = readFileSync(filePath, "utf8");
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    return { success: false, warnings: [], errors: [{ message: `YAML parse error: ${(error as Error).message}`, path: "" }] };
  }
  return loadIntent(raw, expectedId === undefined ? {} : { expectedId });
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function serializeTriple(triple: Triple): Record<string, unknown> {
  const out: Record<string, unknown> = { id: triple.id, subject: triple.subject, predicate: triple.predicate, object: triple.object };
  if (triple.polarity !== "positive") out.polarity = triple.polarity;
  if (triple.quantifier !== undefined) out.quantifier = triple.quantifier;
  if (triple.scope !== undefined) out.scope = triple.scope;
  return out;
}

function serializeAntecedent(antecedent: AntecedentTriple): Record<string, unknown> {
  const out: Record<string, unknown> = { id: antecedent.id, subject: antecedent.subject, predicate: antecedent.predicate, object: antecedent.object };
  if (antecedent.polarity !== "positive") out.polarity = antecedent.polarity;
  return out;
}

/** Canonical, deterministic YAML form: fixed field order, triples sorted by id. */
export function serializeIntent(intent: Intent): string {
  const out: Record<string, unknown> = {
    schema_version: intent.schema_version,
    id: intent.id,
    description: intent.description,
    obligation: intent.obligation,
    compose: intent.compose,
  };
  if (intent.compose === "implies") {
    out.antecedent = [...(intent.antecedent ?? [])].sort(byId).map(serializeAntecedent);
    out.consequent = [...(intent.consequent ?? [])].sort(byId).map(serializeTriple);
  } else {
    out.triples = [...(intent.triples ?? [])].sort(byId).map(serializeTriple);
  }
  if (intent.relates_to.length > 0) out.relates_to = intent.relates_to;
  return stringifyYaml(out);
}

export function writeIntentFile(filePath: string, intent: Intent): void {
  atomicWriteFile(filePath, serializeIntent(intent));
}
