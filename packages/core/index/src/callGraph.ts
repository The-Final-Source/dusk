import { dirname, join } from "node:path";

/**
 * Structural call-graph construction for the `S ⊆ D` drift detector — Phase 5
 * design D5. Built with the SAME lightweight line-structural parse philosophy
 * `@dusk/core-decoration` uses (one parser stack — deliberately NO second TS
 * toolchain). Method calls and computed invocations are `dynamic` — the
 * conservative default treats them as uninstrumented (they contribute ∅).
 */

export type FunctionUnit = {
  file: string;
  name: string;
  /** 1-based declaration line. */
  startLine: number;
  /** 1-based last line of the unit (matching brace, or the declaration line for expression arrows). */
  endLine: number;
  exported: boolean;
};

export type CallSite = {
  file: string;
  /** 1-based line of the call. */
  line: number;
  callee: string;
  /** `identifier` calls resolve through the graph; `dynamic` ones are uninstrumented by definition. */
  kind: "identifier" | "dynamic";
};

const FUNCTION_DECL_RE = /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/;
const ARROW_DECL_RE = /^\s*(export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=]+)?=>/;
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "typeof", "new", "await", "void", "else", "do", "throw"]);

function stripStringsAndComments(line: string): string {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/'(\\.|[^'\\])*'/g, "''")
    .replace(/`(\\.|[^`\\])*`/g, "``");
}

function netBraces(line: string): number {
  const text = stripStringsAndComments(line);
  let n = 0;
  for (const ch of text) {
    if (ch === "{") n += 1;
    else if (ch === "}") n -= 1;
  }
  return n;
}

/** Parse the file's function units (named functions + const-arrow bindings). */
export function parseFunctionUnits(source: string, file: string): FunctionUnit[] {
  const lines = source.split(/\r?\n/);
  const units: FunctionUnit[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const fn = lines[i].match(FUNCTION_DECL_RE);
    const arrow = fn ? null : lines[i].match(ARROW_DECL_RE);
    const match = fn ?? arrow;
    if (!match) continue;

    const exported = Boolean(match[1]);
    const name = match[2];
    if (!stripStringsAndComments(lines[i]).includes("{")) {
      // Expression-bodied arrow (single line unit).
      units.push({ file, name, startLine: i + 1, endLine: i + 1, exported });
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < lines.length; j += 1) {
      depth += netBraces(lines[j]);
      if (j > i || lines[j].includes("{")) {
        if (depth <= 0) break;
      }
    }
    units.push({ file, name, startLine: i + 1, endLine: Math.min(j + 1, lines.length), exported });
  }
  return units;
}

/** Call sites within a unit's body lines (declaration line excluded). */
export function parseCallSites(source: string, unit: FunctionUnit): CallSite[] {
  const lines = source.split(/\r?\n/);
  const sites: CallSite[] = [];
  for (let i = unit.startLine; i < unit.endLine; i += 1) {
    const text = stripStringsAndComments(lines[i] ?? "");
    for (const m of text.matchAll(/([.]?)\s*\b([A-Za-z0-9_$]+)\s*\(/g)) {
      const callee = m[2];
      if (KEYWORDS.has(callee)) continue;
      const dynamic = m[1] === "." || /\bnew\s+$/.test(text.slice(0, m.index ?? 0));
      sites.push({ file: unit.file, line: i + 1, callee, kind: dynamic ? "dynamic" : "identifier" });
    }
  }
  return sites;
}

const IMPORT_RE = /^\s*import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/;

/** Resolve a relative import specifier against the known repo-relative file set. */
function resolveSpecifier(fromFile: string, spec: string, knownFiles: Set<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = join(dirname(fromFile), spec).replaceAll("\\", "/").replace(/^\.\//, "");
  const candidates = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), `${base}.ts`, `${base}.tsx`];
  return candidates.find((c) => knownFiles.has(c)) ?? null;
}

/** Per-file imported-name → resolved repo-relative file (unresolvable specs omitted → uninstrumented). */
export function parseImports(source: string, file: string, knownFiles: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(IMPORT_RE);
    if (!m) continue;
    const resolved = resolveSpecifier(file, m[2], knownFiles);
    if (!resolved) continue;
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) out.set(name, resolved);
    }
  }
  return out;
}
