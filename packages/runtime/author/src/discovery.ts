import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Stage-2 discovery: a grep pass over `intent.yaml` files under `.ia/intents/`
 * matching the request's framing keywords against description + triple slot
 * content (RFC §5 Stage 2, §8.10; design Q1). Deliberately NO vector search,
 * NO embedding substrate, NO RAG layer — full-text matching only; the frontier
 * model classifies the surfaced candidates (`conflict | overlap | gray |
 * adjacent`) via the generator seam.
 */

export type TensionCandidate = { path: string; excerpt: string };

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "into", "is", "it", "its", "must", "may", "no", "not", "of", "on", "or",
  "our", "should", "that", "the", "their", "then", "this", "to", "use", "we",
  "when", "which", "will", "with", "add", "new", "support",
]);

export function framingKeywords(request: string): string[] {
  return [
    ...new Set(
      request
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    ),
  ];
}

function* walkIntentFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkIntentFiles(full);
    else if (entry.name === "intent.yaml") yield full;
  }
}

/**
 * The Stage-2 intent-tree census (RFC §5; App. D.25) — a general, deterministic
 * list of every intent path in the tree plus whether the tree is empty. It is
 * NOT a bootstrap-specific signal: it is just "what intents exist", which the
 * Author uses to detect tensions in BOTH directions — against intents that exist
 * (conflict/overlap/gray/adjacent) and against an intent the request depends on
 * that does NOT exist (a `prerequisite` tension). The greenfield foundation (an
 * empty census) is simply the most common `prerequisite` case, carrying no
 * special state into the flow.
 */
export type IntentCensus = {
  /** Every intent path currently in the tree (sorted). */
  intent_paths: string[];
  /** True when the tree has NO intents at all. */
  is_empty: boolean;
};

export function intentTreeCensus(rootDir: string, intentsDir: string): IntentCensus {
  const root = join(rootDir, intentsDir);
  if (!existsSync(root)) return { intent_paths: [], is_empty: true };
  const paths: string[] = [];
  for (const file of walkIntentFiles(root)) {
    paths.push(relative(root, file).replace(/\/intent\.yaml$/, ""));
  }
  return { intent_paths: paths.sort(), is_empty: paths.length === 0 };
}

/** Grep the intent tree for keyword matches; returns up to `cap` candidates with excerpts. */
export function discoverTensionCandidates(rootDir: string, intentsDir: string, request: string, cap = 8): TensionCandidate[] {
  const root = join(rootDir, intentsDir);
  if (!existsSync(root)) return [];
  const keywords = framingKeywords(request);
  if (keywords.length === 0) return [];

  const out: TensionCandidate[] = [];
  for (const file of walkIntentFiles(root)) {
    const text = readFileSync(file, "utf8");
    const lower = text.toLowerCase();
    const hits = keywords.filter((k) => lower.includes(k));
    if (hits.length === 0) continue;
    const lines = text.split("\n");
    const firstHitLine = lines.find((line) => keywords.some((k) => line.toLowerCase().includes(k))) ?? lines[0];
    const intentPath = relative(root, file).replace(/\/intent\.yaml$/, "");
    out.push({ path: intentPath, excerpt: firstHitLine.trim() });
    if (out.length >= cap) break;
  }
  return out;
}
