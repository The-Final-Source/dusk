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
 * The Stage-2 foundation-gap signal (RFC §5; App. D.24/D.25). A deterministic
 * census of the intent tree the Author reasons over: the full set of existing
 * intent paths, plus whether the tree is empty. `empty_tree` is the unambiguous
 * greenfield-first-intent case — any behavior intent authored into an empty tree
 * presupposes a foundation (project/tech-stack setup, app bootstrap, persistence
 * layer, module structure) that does not yet exist, so the Author should steer
 * the user to author those foundation intents FIRST. For a non-empty tree the
 * census lets the model judge a richer per-surface gap. This is the deterministic
 * backstop behind the model's judgment — never the whole judgment.
 */
export type FoundationSignal = {
  /** Every intent path currently in the tree (sorted); the model judges richer gaps from it. */
  existing_intent_paths: string[];
  /** True when the tree has NO intents at all (greenfield-first-intent). */
  empty_tree: boolean;
};

export function detectFoundationGap(rootDir: string, intentsDir: string): FoundationSignal {
  const root = join(rootDir, intentsDir);
  if (!existsSync(root)) return { existing_intent_paths: [], empty_tree: true };
  const paths: string[] = [];
  for (const file of walkIntentFiles(root)) {
    paths.push(relative(root, file).replace(/\/intent\.yaml$/, ""));
  }
  return { existing_intent_paths: paths.sort(), empty_tree: paths.length === 0 };
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
