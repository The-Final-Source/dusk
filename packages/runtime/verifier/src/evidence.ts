import type { DerivedIndex } from "@dusk/core-index";
import { duskError, type RuntimeResult } from "@dusk/core-schema";

/**
 * Scoped evidence assembly (RFC §3.3, §4.2; design D8; Plan P2-T10). For an
 * `(intent, aspect)` the Verifier reads ONLY the focal claimants' code lines and
 * the support claimants' code lines (+ inline NL triple) — never the whole body.
 * Total assembled lines are capped by `verifier_evidence_max_lines`; overflow is
 * a structural error, never a silent truncation.
 */
export type FocalEvidence = { file: string; lines: [number, number]; quote: string };
export type SupportEvidence = {
  file: string;
  lines: [number, number];
  quote: string;
  support_triple: [string, string, string];
};
export type AspectEvidence = { focal: FocalEvidence[]; support: SupportEvidence[]; totalLines: number };

/** First non-comment, non-blank code line at or after a decorator-comment line. */
function firstCodeLine(lines: string[], fromLine1Based: number): { lineNo: number; text: string } | null {
  for (let i = Math.max(0, fromLine1Based - 1); i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("//")) continue;
    return { lineNo: i + 1, text: lines[i].trim() };
  }
  return null;
}

export type ReadFile = (file: string) => string;

export function assembleEvidence(
  intentPath: string,
  aspectId: string,
  index: DerivedIndex,
  readFile: ReadFile,
  maxLines: number,
): RuntimeResult<AspectEvidence> {
  const { focal, support } = index.focalSupport(intentPath, aspectId);
  const sources = new Map<string, string[]>();
  const linesOf = (file: string): string[] => {
    if (!sources.has(file)) sources.set(file, readFile(file).split(/\r?\n/));
    return sources.get(file)!;
  };

  const seenLines = new Set<string>();
  const focalEvidence: FocalEvidence[] = [];
  for (const record of focal) {
    const code = firstCodeLine(linesOf(record.file), record.line);
    if (!code) continue;
    focalEvidence.push({ file: record.file, lines: [code.lineNo, code.lineNo], quote: code.text });
    seenLines.add(`${record.file}:${code.lineNo}`);
  }

  const supportEvidence: SupportEvidence[] = [];
  for (const record of support) {
    const code = firstCodeLine(linesOf(record.file), record.line);
    if (!code || record.support_triple === null) continue;
    supportEvidence.push({
      file: record.file,
      lines: [code.lineNo, code.lineNo],
      quote: code.text,
      support_triple: record.support_triple as [string, string, string],
    });
    seenLines.add(`${record.file}:${code.lineNo}`);
  }

  const totalLines = seenLines.size;
  if (totalLines > maxLines) {
    return {
      success: false,
      error: duskError(
        "verifier_evidence_too_large",
        `assembled evidence for ${intentPath} [${aspectId}] is ${totalLines} lines (cap ${maxLines})`,
        { recoverable: false, details: { intentPath, aspectId, totalLines, maxLines } },
      ),
    };
  }
  return { success: true, value: { focal: focalEvidence, support: supportEvidence, totalLines } };
}
