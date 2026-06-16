import type { DecorationMarker, DecorationRecord, DecorationScope, IgnoreClause, SupportTriple } from "./types.js";

const MARKER_RE = /^\s*\/\/\s*@intent(-support|-test-file|-test|-file|-ignore)?(?=\s|$)\s*(.*)$/;

function suffixToMarker(suffix: string | undefined): DecorationMarker {
  switch (suffix) {
    case "-support":
      return "intent-support";
    case "-test-file":
      return "intent-test-file";
    case "-test":
      return "intent-test";
    case "-file":
      return "intent-file";
    case "-ignore":
      return "intent-ignore";
    default:
      return "intent";
  }
}

type RestFields = Pick<DecorationRecord, "intent_path" | "aspect_ids" | "support_triple" | "ignore_clause">;

function parseRest(marker: DecorationMarker, rest: string): RestFields | null {
  const pathMatch = rest.match(/^([^\s[]+)/);
  if (!pathMatch) return null;
  const intentPath = pathMatch[1];
  const remainder = rest.slice(pathMatch[1].length);

  let aspectIds: string[] | null = null;
  let supportTriple: SupportTriple | null = null;
  for (const group of remainder.matchAll(/\[([^\]]*)\]/g)) {
    const inner = group[1];
    if (inner.includes('"')) {
      const parts = [...inner.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      if (parts.length === 3) supportTriple = [parts[0], parts[1], parts[2]];
    } else {
      const ids = inner.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) aspectIds = ids;
    }
  }

  let ignoreClause: IgnoreClause | null = null;
  if (marker === "intent-ignore") {
    const because = remainder.match(/because=\(([^)]*)\)/);
    const reason = remainder.match(/reason="([^"]*)"/);
    if (because && reason) {
      const parts = because[1].split(",").map((s) => s.trim());
      if (parts.length === 3) ignoreClause = { because: [parts[0], parts[1], parts[2]], reason: reason[1] };
    }
  }

  return { intent_path: intentPath, aspect_ids: aspectIds, support_triple: supportTriple, ignore_clause: ignoreClause };
}

const DECLARATION_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|enum|type|interface)\s+([A-Za-z0-9_$]+)/;

function resolveScope(marker: DecorationMarker, lines: string[], index: number): { scope: DecorationScope; declaration_name: string | null } {
  if (marker === "intent-file" || marker === "intent-test-file") return { scope: "file", declaration_name: null };
  for (let j = index + 1; j < lines.length; j += 1) {
    const line = lines[j].trim();
    if (line === "" || line.startsWith("//")) continue;
    const declaration = line.match(DECLARATION_RE);
    if (declaration) return { scope: "declaration", declaration_name: declaration[1] };
    return { scope: "statement", declaration_name: null };
  }
  return { scope: "statement", declaration_name: null };
}

/** Parse all decoration markers out of a TypeScript source into structured records. */
export function parseDecorations(source: string, file: string): DecorationRecord[] {
  const lines = source.split(/\r?\n/);
  const records: DecorationRecord[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const matched = lines[i].match(MARKER_RE);
    if (!matched) continue;
    const marker = suffixToMarker(matched[1]);
    const rest = parseRest(marker, matched[2]);
    if (!rest) continue;
    const { scope, declaration_name } = resolveScope(marker, lines, i);
    records.push({ file, line: i + 1, scope, declaration_name, marker, ...rest, anchor: null, verify: "semantic" });
  }
  return records;
}
