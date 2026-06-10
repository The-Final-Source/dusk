import type { DerivedIndex } from "@dusk/core-index";

/**
 * `enrichDialogSeed` (Phase-4 design D4) — the pure Decomposer-Author bridge.
 * Replaces Phase 3's naive `unresolved_refs.join(", ")` stub: for each
 * unresolved reference the seed names the surrounding intent context (nearest
 * existing ancestor, siblings, `relates_to`-linked intents, the original
 * request) in business-vocabulary terms, producing a Stage-1 framing prompt
 * `dusk_author_start` can consume directly. Pure → deterministic →
 * unit-testable; the `ImplementCheckpoint` SHAPE stays frozen (content only).
 */

const pathParent = (intentPath: string): string => intentPath.split("/").slice(0, -1).join("/");

const lastSegment = (intentPath: string): string => intentPath.split("/").at(-1) ?? intentPath;

/** Humanize a path segment: "cursor-encode" → "cursor encode". */
const humanize = (segment: string): string => segment.replace(/-/g, " ");

function nearestExistingAncestor(ref: string, index: DerivedIndex): string | null {
  for (let parent = pathParent(ref); parent.length > 0; parent = pathParent(parent)) {
    if (index.intents.has(parent)) return parent;
  }
  return null;
}

function describeRef(ref: string, request: string | undefined, index: DerivedIndex): string {
  const lines: string[] = [];
  lines.push(
    request
      ? `The request "${request}" references an intent "${ref}" that doesn't exist.`
      : `An intent "${ref}" is referenced but doesn't exist.`,
  );

  const ancestor = nearestExistingAncestor(ref, index);
  if (ancestor) {
    const ancestorIntent = index.intents.get(ancestor)!;
    lines.push(`Its parent "${ancestor}" exists — ${ancestorIntent.description}`);

    const siblings = [...index.intents.keys()].filter((p) => p !== ref && pathParent(p) === ancestor).sort();
    if (siblings.length > 0) {
      const described = siblings.map((s) => `${humanize(lastSegment(s))} (${s})`).join(", ");
      lines.push(`It already covers ${described}, but not ${humanize(lastSegment(ref))}.`);
    }
  } else {
    lines.push(`No ancestor of "${ref}" exists yet — this is a new intent subtree.`);
  }

  const linkedFrom = [...index.intents.entries()]
    .filter(([, intent]) => (intent.relates_to ?? []).some((rel) => rel.target === ref))
    .map(([path, intent]) => {
      const kind = (intent.relates_to ?? []).find((rel) => rel.target === ref)!.kind;
      return `"${path}" (${kind})`;
    })
    .sort();
  if (linkedFrom.length > 0) {
    lines.push(`Existing intents point at it via relates_to: ${linkedFrom.join(", ")}.`);
  }

  lines.push(`Please describe the ${humanize(lastSegment(ref))} behavior you want.`);
  return lines.join(" ");
}

/** Build the enriched Stage-1 framing seed for the `ImplementCheckpoint` (design D4 signature). */
export function enrichDialogSeed(unresolvedRefs: string[], snapshot: DerivedIndex, request?: string): string {
  return [...unresolvedRefs]
    .sort()
    .map((ref) => describeRef(ref, request, snapshot))
    .join("\n\n");
}
