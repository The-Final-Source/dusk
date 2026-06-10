import { parseDecorations, type DecorationRecord } from "@dusk/core-decoration";
import { resolveDecorationConflict, type ConflictSide } from "@dusk/runtime-conflict-resolver";

/**
 * Decorator-aware resolution of a real rebase conflict (RFC §6.8; design D11;
 * P3-T20). For each conflicted file we read both sides' versions from the index
 * (stage 2 = ours/main, stage 3 = theirs/branch), extract the focal decoration on
 * each, and ask the Conflict Resolver to prefer the more-specific side. A clear
 * winner resolves the file by checking out that side; an equal-specificity tie
 * writes a TODO marker and leaves the conflict for a human reviewer.
 */

type GitRunner = (cwd: string, args: string[], stdin?: string) => string;

export type FileResolution =
  | { file: string; kind: "prefer"; side: "ours" | "theirs"; reason: string }
  | { file: string; kind: "tie"; todo: string };

const focalDecoration = (source: string, file: string): DecorationRecord | undefined =>
  parseDecorations(source, file).find((r) => r.marker === "intent" || r.marker === "intent-file");

const toSide = (label: "a" | "b", rec: DecorationRecord | undefined): ConflictSide => ({
  label,
  intentPath: rec?.intent_path ?? "",
  aspectIds: rec?.aspect_ids ?? [],
  body: "",
});

/** Resolve every conflicted file decorator-aware; returns one resolution per file. */
export function resolveConflictedFiles(repoDir: string, conflictedFiles: string[], git: GitRunner): FileResolution[] {
  const out: FileResolution[] = [];
  for (const file of conflictedFiles) {
    let ours = "";
    let theirs = "";
    try {
      ours = git(repoDir, ["show", `:2:${file}`]);
    } catch {
      /* added/deleted on one side */
    }
    try {
      theirs = git(repoDir, ["show", `:3:${file}`]);
    } catch {
      /* added/deleted on one side */
    }
    const decision = resolveDecorationConflict(
      toSide("a", focalDecoration(ours, file)),
      toSide("b", focalDecoration(theirs, file)),
      file,
    );
    if (decision.kind === "prefer") {
      const side = decision.chosen.label === "a" ? "ours" : "theirs";
      out.push({ file, kind: "prefer", side, reason: decision.reason });
    } else {
      out.push({ file, kind: "tie", todo: decision.todo });
    }
  }
  return out;
}
