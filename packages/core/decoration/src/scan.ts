import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { createIgnoreMatcher, DEFAULT_DECORATION_IGNORE } from "./ignore.js";
import { parseDecorations } from "./parseDecorations.js";
import { parseDotIntent } from "./parseDotIntent.js";
import { parseFileIntentSidecar } from "./parseFileIntentSidecar.js";
import type { DecorationRecord } from "./types.js";

/**
 * The shared decoration scanner (keystone, design D1). It replaces the three
 * `.ts`-only walkers — `packages/delivery/mcp-server/src/context.ts`,
 * `packages/cli/src/project.ts`, `packages/cli/src/doctorStaticAnalysis.ts` —
 * AND their three divergent hardcoded `SKIP_DIRS` (board M2). One walk, one
 * file-class dispatch, one ignore SSoT — so directory `.intent` and per-file
 * sidecar records reach `buildDerivedIndex` (and thus the Verifier, the
 * reverse-index, and doctor), closing the gap where `.intent` was parsed only by
 * the gate.
 */

/** Comment-bearing source extensions parsed for inline `// @intent` decoration. */
export const SOURCE_EXT: ReadonlySet<string> = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

export type ScanOptions = {
  /** `decoration.ignore` globs (defaults applied when omitted; see §4 `loadIgnoreGlobs`). */
  ignore?: readonly string[];
  /** Comment-bearing source extensions (defaults to {@link SOURCE_EXT}). */
  sourceExt?: ReadonlySet<string>;
  /** Read a target relative to `rootDir` (sidecar coverage needs the target source). */
  readTarget?: (relTargetPath: string) => string | null;
};

/** Classify a basename for the file-class dispatch. */
function fileClass(name: string, sourceExt: ReadonlySet<string>): "inline" | "dot-intent" | "sidecar" | "skip" {
  if (name === ".intent") return "dot-intent";
  if (name.endsWith(".intent")) return "sidecar"; // `<stem>.intent`, stem non-empty
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "skip";
  const ext = name.slice(dot);
  if (name.endsWith(".d.ts")) return "skip"; // generated declarations carry no authored intent
  return sourceExt.has(ext) ? "inline" : "skip";
}

/** Walk the project, dispatch by file class, and return the merged `DecorationRecord[]`. */
export function scanDecorations(rootDir: string, opts: ScanOptions = {}): DecorationRecord[] {
  const sourceExt = opts.sourceExt ?? SOURCE_EXT;
  const isIgnored = createIgnoreMatcher(opts.ignore ?? DEFAULT_DECORATION_IGNORE);
  const readTarget =
    opts.readTarget ??
    ((rel: string): string | null => {
      try {
        return readFileSync(join(rootDir, rel), "utf8");
      } catch {
        return null;
      }
    });

  const records: DecorationRecord[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const rel = relative(rootDir, full);
      if (isIgnored(rel)) continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      const cls = fileClass(entry, sourceExt);
      if (cls === "skip") continue;
      const source = readFileSync(full, "utf8");
      if (cls === "inline") {
        records.push(...parseDecorations(source, rel));
      } else if (cls === "dot-intent") {
        records.push(...parseDotIntent(source, rel).records);
      } else {
        // `<stem>.intent` per-file sidecar — its target is the stem beside it.
        const targetRel = relative(rootDir, join(dir, basename(entry, ".intent")));
        const targetSource = readTarget(targetRel);
        if (targetSource === null) continue; // target absent → the gate/doctor reports it, not the scanner
        records.push(...parseFileIntentSidecar(source, targetSource, rel, targetRel).records);
      }
    }
  };
  walk(rootDir);
  return records;
}
