# Excalidraw Sub-skill — Whiteboard

Freeform sketches, rough metaphors, throwaway visualizations of abstract ideas. The viewer reads the diagram to absorb a concept quickly — the artifact is meant to feel ad-hoc, not engineered.

## Composition rigor for whiteboards

Even a deliberately rough sketch benefits from discipline. Before writing the spec, decide:

- **The metaphor.** A whiteboard sketch usually visualizes ONE metaphor: "the iceberg," "the funnel," "the layered cake," "the spectrum." Name it explicitly. If you can't, the diagram is probably trying to do something less freeform — pick a different sub-skill.
- **Sketchy on purpose.** Use `roughness: 1` (Excalidraw default) and `fontFamily: 1` (Virgil — hand-drawn) throughout. Don't mix hand-drawn and clean — a sketch with one perfectly geometric box looks accidental.
- **Constrained palette.** 2–3 colors max. Whiteboards work best when most ink is grayscale and color is reserved for emphasis.
- **Annotations carry the meaning.** Whiteboard sketches lean heavily on text annotations: arrows pointing at parts of an illustration with brief labels, callouts explaining what a fuzzy shape represents. Use `text` primitives liberally; budget ~30% of canvas area for text.
- **Embrace `freedraw`.** Squiggly lines, underlines, lassos that highlight a region — `freedraw` is the only primitive that visually says "hand-drawn." Use it for accents and emphasis.

## Whiteboard-specific moves

- **Underline emphasis.** A `freedraw` squiggle under an important phrase highlights it without needing a different font weight.
- **Lasso to group.** A `freedraw` loop drawn around a cluster of shapes visually groups them more casually than a `frame`. Use lasso when the grouping is provisional ("these go together but the relationship is still being worked out"); use `frame` when the grouping is structural.
- **Big arrows for the metaphor.** A whiteboard explaining a funnel has ONE big arrow showing the funnel direction, not 12 small arrows showing every step. Reduce arrow count; lean on spatial position.
- **Margin notes.** Marginalia (a small text aside next to the main illustration) feels natural on a whiteboard. Use 12–14px gray text in the negative space.

## What whiteboards are NOT

- **Not a flowchart.** If your "whiteboard" has more than three arrows showing transitions, use the flowchart sub-skill instead.
- **Not a comparison table.** A table belongs in markdown or a slide layout, not a whiteboard sketch.
- **Not a data viz.** Whiteboards don't have axes, scales, or quantitative encoding. If you need to communicate numbers, choose a different artifact.
- **Not a polished doc.** A whiteboard sketch is okay being slightly imperfect — that's the point. Don't try to polish it into a production architecture diagram.

## Common whiteboard mistakes

- **Too clean.** A whiteboard that looks like a production system diagram has lost the freeform vibe. If everything aligns perfectly to a 60-pixel grid, you've over-designed.
- **Too messy.** "Freeform" doesn't mean "random." Elements still need readable hierarchy and breathing room.
- **Mixed styles.** Some shapes hand-drawn, others geometric. Pick one (`roughness: 1`, `fontFamily: 1`) and apply throughout.
- **Missing the metaphor.** If a viewer can't extract the central image / metaphor in 5 seconds, you've over-decorated the supporting detail.

## Design-critic mandate addition (whiteboard-specific)

When invoking the design critic from SKILL.md, append this scenario-specific check:

```
Additionally, audit WHITEBOARD-SPECIFIC correctness:

A. Central metaphor. Is there ONE clear central image or metaphor
   that the diagram visualizes? Can you name it in 5 words?
B. Stylistic coherence. Are all shapes consistently sketchy
   (roughness 1, Virgil fontFamily)? Any clean geometric shapes
   intruding on the hand-drawn aesthetic?
C. Restrained palette. Are there at most 2-3 colors? Is most ink
   grayscale, with color reserved for emphasis?
D. Annotation density. Is text used liberally to explain the
   sketch? Roughly 30% of canvas area is text/annotations?
E. Scope appropriateness. Is this actually a whiteboard sketch
   (loose, illustrative) and not a structured diagram in disguise
   (flowchart, architecture, etc.)?
F. Freedraw usage. Are freedraw strokes present and serving
   emphasis / grouping purposes? A whiteboard with NO freedraw
   probably wanted a different sub-skill.

Treat any failure here as a REVISE per the main rubric.
```

## When to load this sub-skill

- User asks for a quick sketch, an "illustration" of an abstract idea, or a "rough drawing".
- User wants to visualize a metaphor (the iceberg, the funnel, the layered cake).
- The artifact is intentionally informal — a working sketch, not a delivered diagram.
