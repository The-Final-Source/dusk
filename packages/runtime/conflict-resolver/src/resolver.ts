/**
 * Decorator-aware Conflict Resolver (RFC §6.8; design D11; 11.4 / P3-T20). On a
 * real rebase conflict involving decorated code it prefers the MORE-SPECIFIC
 * side: more declared aspect ids wins; on a tie, the more granular (deeper)
 * intent path wins; an exact tie is left as a TODO marker so a human adjudicates
 * (and the rebase fails with the TODO present). `memory: none` (RFC §9 role
 * table) — this is a pure, stateless decision.
 */

export type ConflictSide = {
  label: "a" | "b";
  intentPath: string;
  aspectIds: string[];
  body: string;
};

export type ConflictResolution =
  | { kind: "prefer"; chosen: ConflictSide; reason: string }
  | { kind: "tie"; todo: string };

const pathDepth = (intentPath: string): number => intentPath.split("/").length;

/** Specificity tuple: (#aspect ids, path depth). */
const specificity = (side: ConflictSide): [number, number] => [side.aspectIds.length, pathDepth(side.intentPath)];

export function resolveDecorationConflict(a: ConflictSide, b: ConflictSide, region = "conflicting region"): ConflictResolution {
  const [aspA, depthA] = specificity(a);
  const [aspB, depthB] = specificity(b);

  if (aspA !== aspB) {
    const chosen = aspA > aspB ? a : b;
    return { kind: "prefer", chosen, reason: `more aspect ids (${chosen.aspectIds.length})` };
  }
  if (depthA !== depthB) {
    const chosen = depthA > depthB ? a : b;
    return { kind: "prefer", chosen, reason: `more granular intent path (${chosen.intentPath})` };
  }
  return {
    kind: "tie",
    todo: renderTodo(a, b, region),
  };
}

/** A TODO marker written into the merged file for an equal-specificity tie. */
export function renderTodo(a: ConflictSide, b: ConflictSide, region: string): string {
  return [
    `// TODO(dusk-conflict): equal-specificity decoration conflict in ${region} — human review required.`,
    `//   side a: @intent ${a.intentPath} [${a.aspectIds.join(", ")}]`,
    `//   side b: @intent ${b.intentPath} [${b.aspectIds.join(", ")}]`,
    `//   reason: both sides declare identical specificity (${a.aspectIds.length} aspect ids, depth ${pathDepth(a.intentPath)}).`,
  ].join("\n");
}
