# Excalidraw Sub-skill — Mindmap

Concept maps, brainstorm captures, hierarchical decompositions. The viewer reads the diagram to understand "what relates to what" around a central topic — radial structure with a clear focal point and outward branches.

## Composition rigor for mindmaps

Before writing the spec, decide:

- **The central concept.** One shape, dead center, visually dominant. The whole diagram exists to expand on this concept. If you have two candidate centers, you actually have two mindmaps.
- **Radial layout.** Children fan out around the center. For a small mindmap (≤ 8 children), distribute them evenly around 360°. For a larger one, lean toward 180° (semi-circle below or beside the center) so the diagram has a clear reading direction.
- **Depth limit.** Three levels is the max that still reads clearly: center → primary branches → secondary branches. Going deeper produces visual noise. If a branch wants to go three levels deeper, that branch is its own mindmap.
- **Connector style.** Curved or angled connectors look better in radial layouts than straight ones, but Excalidraw arrows are straight. So:
  - Use `line` (no arrowhead) for radial connectors — the implied relationship is "elaborates on," not "transitions to."
  - Use lower stroke weight (1px) and lower opacity for connectors. They're tertiary; the shapes carry the content.
- **Shape conventions.** Mindmaps look natural with `roughness: 1` (hand-drawn) and `fontFamily: 1` (Virgil). Convention is loose; cohere within the diagram.

## Hierarchy through size and color

Visual hierarchy in a mindmap maps directly to conceptual hierarchy:

- **Central concept**: largest font (28–36px), bold color, distinctive shape (ellipse or rounded rectangle).
- **Primary branches**: medium font (20–24px), filled with the brand or palette color.
- **Secondary branches**: small font (14–16px), no fill or very light fill, thin stroke.

Don't give a secondary branch the same visual weight as a primary branch — even if the content feels equally important, the reader needs the hierarchy to navigate.

## Common mindmap mistakes

- **No clear center.** When two or three shapes have equal visual weight at the middle of the canvas, the reader doesn't know where to start.
- **Branches at random angles.** Children placed at irregular intervals (one at 30°, the next at 75°, the next at 110°) look haphazard. Distribute evenly or follow a clear grid.
- **Crossed connectors.** Two radial connectors crossing means the layout is wrong. Re-arrange so connectors don't cross.
- **Forgetting it's a mindmap.** A mindmap is for exploring relationships around a central idea. If your "mindmap" has 6 columns of unrelated topics, you wanted a comparison table or a multi-panel doc.

## Design-critic mandate addition (mindmap-specific)

When invoking the design critic from SKILL.md, append this scenario-specific check:

```
Additionally, audit MINDMAP-SPECIFIC correctness:

A. Single focal point. Is there exactly ONE central concept, visually
   distinct from all others (larger, bolder, distinctive shape)?
B. Radial distribution. Are primary branches distributed evenly
   around the center (or along a clear arc)? No clusters in one
   quadrant and emptiness in another?
C. Depth discipline. Are there at most three levels of hierarchy
   (center → primary → secondary)? Deeper nestings are flagged.
D. No crossed connectors. Do any radial connectors cross each other?
   If so, the angular layout needs to be re-ordered.
E. Visual hierarchy matches conceptual hierarchy. Are primary
   branches visibly heavier than secondary branches (font size,
   color, stroke)?
F. Connector semantic. Are connectors styled as "elaboration" (thin,
   no arrowhead, lower opacity) rather than "transition" (thick,
   arrow, full opacity)?

Treat any failure here as a REVISE per the main rubric.
```

## When to load this sub-skill

- User asks for a concept map or mindmap around a central topic.
- User wants to brainstorm and capture the structure of a multi-faceted idea.
- The diagram is hierarchical decomposition (a thing → its parts → their parts).
