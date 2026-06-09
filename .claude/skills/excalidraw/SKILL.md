---
name: excalidraw
description: >
  Produce editable Excalidraw diagrams (.excalidraw + .png + .svg) from a
  thin primitives spec. The tool emits Excalidraw primitives — rectangle,
  ellipse, diamond, arrow, line, text, freedraw, frame, image,
  embeddable, iframe — and nothing more. No baked-in layouts, palettes,
  decorations, scales, or content opinions. The agent owns every
  position, size, color, label, and font choice; the tool only renders
  and structurally validates (ids, bindings, frame children, text fit
  within viewport, label fit within container). After render, a single
  specialized design critic methodically inspects every region of the
  output and gates shipping. Use whenever a diagram belongs in a doc,
  slide, blog post, or working artifact.
---

# Excalidraw Diagram Skill

You produce a diagram by:

1. **Thinking rigorously** about composition, content, and craft (this is most of the work).
2. **Writing a primitive spec** — one JSON file, one `elements: []` array of Excalidraw primitives, every position/size/color/label chosen deliberately.
3. **Rendering** with the build script — emits `.excalidraw` + `.png` + `.svg`.
4. **Running the design critic** on the rendered output. Iterate until it passes.

The tool does not paper over weak authoring. There are no layout strategies, palette tokens, decoration shortcuts, or auto-prettifiers. If a diagram is well-composed, that is because **you** composed it well.

## When to use

- A doc, slide, blog post, or internal artifact needs a diagram (flowchart, system architecture, data flow, mindmap, freeform sketch).
- The artifact must remain **editable later** (an actual `.excalidraw` file), not just an image.
- The diagram needs visual rigor before delivery.

## When NOT to use

- For Mermaid diagrams meant for a specific Mermaid-rendering surface (e.g., GitHub README). Generate Mermaid directly there.
- For data-driven charts (bar, line, area). Excalidraw is for relational/hand-drawn diagrams, not quantitative chart rendering.
- For a quick napkin sketch you'll throw away within the hour. The thinking discipline below is real overhead; only invest it when the diagram has a job to do.

## Sub-skills

Load the sub-skill that matches what you're producing. Each one expands the **rigor checklist** for its diagram type and refines the **design-critic mandate** for that scenario.

| Scenario | Sub-skill | When to load |
|---|---|---|
| Process flow, decision tree, swimlane | [`sub-skills/flowchart.md`](sub-skills/flowchart.md) | Sequential steps, branching decisions, role lanes |
| System / service / deployment topology | [`sub-skills/architecture.md`](sub-skills/architecture.md) | Components + dependencies, layered systems, deployment topology |
| Pipeline, sequence, ETL, request lifecycle | [`sub-skills/data-flow.md`](sub-skills/data-flow.md) | Source → transform → sink flows, request/response sequences |
| Concept map, mindmap, brainstorm | [`sub-skills/mindmap.md`](sub-skills/mindmap.md) | A central concept radiating into related ideas |
| Freeform sketch / quick whiteboard | [`sub-skills/whiteboard.md`](sub-skills/whiteboard.md) | Rough metaphors, visualization of an abstract concept |

## Prerequisites

```bash
cd .claude/skills/excalidraw/tools/ts && pnpm install --ignore-workspace
```

Playwright needs a Chromium build cached at `~/Library/Caches/ms-playwright/`. If you already use Playwright elsewhere this is a no-op; otherwise run `npx playwright install chromium` once.

The first call auto-builds the renderer bundle (~13 MB) into `tools/ts/src/renderer/dist/`. Subsequent calls reuse it.

---

# Part 1 — Think first, then write the spec

Skipping this phase is the most common reason a diagram requires three rounds of critic-driven rewrites. **Pre-compose deliberately and the spec writes itself.**

## 1.1 Define the diagram's job

Answer in one sentence each, before you draft anything:

- **Audience.** Who will read this? What do they already know?
- **Primary message.** What is the one thing they should walk away understanding? If the diagram disappeared, what gap would that leave?
- **Reading order.** Where does the eye start? Where does it end? What journey does it traverse?
- **Surface.** Where will this render — a slide (16:9, ~1920×1080), a doc page (~1200 wide), a blog post (~800 wide)? Size the viewport to fit the surface.

If you can't answer all four, the diagram isn't ready to be drawn.

## 1.2 Inventory the content

List every distinct concept the diagram must contain. For each:

- **Label.** The exact string. Title Case or sentence case — pick one convention for the whole diagram and stick to it. Use precise verbs (no "manages", "handles", "deals with"); name the actual operation.
- **Role.** Is this a process step? An actor? A data store? A decision? A grouping?
- **Hierarchy.** Is this top-level, supporting, or detail? Top-level concepts are visually dominant; details are visually quiet.

If the inventory has more than ~15 distinct elements, the diagram is probably trying to do two jobs. Split it.

## 1.3 Choose the visual grammar

Decide UP FRONT, not while drafting:

- **Shape vocabulary.** Pick a small set (e.g., rectangle for processes, diamond for decisions, ellipse for data stores) and apply it consistently. Mixing arbitrarily is noise.
- **Color palette.** 3–5 hex colors covering: primary stroke, primary fill, accent stroke, accent fill, plus muted text. Write them down. Reuse them. Don't introduce a sixth halfway through.
- **Typography scale.** 2–3 sizes only — e.g., 28px for the title, 20px for shape labels, 14px for captions. A diagram with seven font sizes is unreadable.
- **Stroke weight scale.** Usually 2 sizes — 2px for primary structure, 1px for connectors and dividers.

## 1.4 Compose the layout on paper (or in your head)

Before opening the spec file, sketch:

- **Grid.** What's the column structure? Row structure? Pitch between rows and columns?
- **Focal points.** Where does the dominant element sit?
- **Reading flow.** Top-to-bottom, left-to-right, or radial? Arrows reinforce this direction.
- **Negative space.** Reserve generous gutters between groups. Crowded diagrams read as chaotic.

## 1.5 Run the pre-render checklist

Before invoking the build, verify against your spec:

- [ ] Every shape with a label either has dimensions large enough OR omits `width`/`height` to auto-fit. (Omitting is usually safer.)
- [ ] Every shape's `x` and `y` are well inside the viewport, with room for the shape's eventual size.
- [ ] Every text element's `x` is far enough left that the rendered width won't overflow (when in doubt, leave `width` omitted — the auto-measure will tell you).
- [ ] Every arrow's `from` and `to` reference an existing shape id.
- [ ] No free-floating text sits in the same region as a shape. If you want a caption attached to a shape, use the shape's `label` field — not a free-floating `text`.
- [ ] Every group of shapes is aligned on the same grid axes (rows on the same `y`, columns on the same `x`).
- [ ] Adjacent shapes don't touch. Minimum gutter ≥ 40px in either direction.
- [ ] Color is consistent — no hex value appears once.
- [ ] Casing is consistent across labels of the same tier.

The build's structural + real-pixel validation will catch viewport overflow, label-fit failures, and free-floating-text-over-shape collisions automatically. The rest (alignment, gutters, color consistency, casing) are your job and the critic's gate.

---

# Part 2 — The primitive API

The tool consumes a single JSON file. Top-level shape:

```jsonc
{
  "$$primitiveVersion": 1,
  "viewport": { "width": 1600, "height": 900 },
  "background": "#FFFFFF",                       // optional, default white
  "elements": [
    // primitives in render order — later elements draw on top
  ]
}
```

Every primitive has a `type` and the fields specific to that type. Two minor ergonomic shortcuts:

1. **`label: "string"` shorthand** on shapes and arrows expands to `{ text: "string", fontSize: 20, fontFamily: 2 }`. Pass an object to override.
2. **`from`/`to` on arrows and lines.** Pass an element id (`"shape-1"`) to bind + auto-compute geometry, OR an absolute point (`{ "x": 100, "y": 200 }`) for free-floating connectors.

**Recommended: omit `width`/`height` on labelled shapes.** The tool measures your label using Excalidraw's actual font and sizes the container to fit (label width + 32 padding × label height + 24 padding). You write position + content; the tool handles the geometry. This is the single most effective way to avoid label-wrapping / container-too-small bugs.

**No other magic exists.** No tokens, no scales, no decorations, no presets, no defaults block, no layouts, no auto-legend, no text policy. Every position is the position you wrote.

Full reference with every field for every primitive: **[`references/primitive-api.md`](references/primitive-api.md)**.

Common authoring mistakes: **[`references/common-mistakes.md`](references/common-mistakes.md)**.

### Minimal spec

```jsonc
{
  "$$primitiveVersion": 1,
  "viewport": { "width": 1000, "height": 400 },
  "elements": [
    { "type": "rectangle", "id": "a", "x": 100, "y": 150, "width": 180, "height": 100,
      "strokeColor": "#1E4B8C", "backgroundColor": "#E0E8F2",
      "label": "Step One" },
    { "type": "rectangle", "id": "b", "x": 400, "y": 150, "width": 180, "height": 100,
      "strokeColor": "#1E4B8C", "backgroundColor": "#E0E8F2",
      "label": "Step Two" },
    { "type": "rectangle", "id": "c", "x": 700, "y": 150, "width": 180, "height": 100,
      "strokeColor": "#1E4B8C", "backgroundColor": "#E0E8F2",
      "label": "Step Three" },
    { "type": "arrow", "from": "a", "to": "b", "strokeColor": "#444444" },
    { "type": "arrow", "from": "b", "to": "c", "strokeColor": "#444444" }
  ]
}
```

A worked example covering every primitive type: `tools/ts/src/__fixtures__/kitchen-sink.spec.json`.

---

# Part 3 — Build

```bash
bash .claude/skills/excalidraw/tools/sh/build.sh \
  --spec path/to/spec.json \
  --out path/to/output-dir \
  [--basename diagram] \
  [--rebuild-renderer]
```

**Output files:**

- `<out>/<basename>.excalidraw` — open in Excalidraw to edit
- `<out>/<basename>.svg` — vector export for embedding
- `<out>/<basename>.png` — raster export (use this for critic review)

**What the build does, in order:**

1. **Read + parse.** Version-gates `$$primitiveVersion`.
2. **Structural validation.** Required fields, unique ids, arrow `from`/`to` refs valid, frame children exist, image src files exist. No rendering needed.
3. **Lower to draft skeleton.** Label-as-string expansion, arrow geometry against placeholder shape sizes, frame auto-fit if children given, image base64 encoding.
4. **Measure pass.** Launch Playwright + the bundled `@excalidraw/excalidraw`. Call `convertToExcalidrawElements` and read back the *actual* computed dimensions of every element, including bound labels.
5. **Auto-fit.** Shapes that omitted width/height get sized from the measured label dims + padding. Arrow geometry recomputed against the final shape sizes.
6. **Real-pixel validation (HARD — blocks the build).** Using the actual measurements, check:
   - No element extends past the viewport edges (precise pixel overflow reported)
   - Every shape label fits inside its container (wrapped height ≤ inner height)
   - No free-floating text overlaps a shape (caption-on-shape error suggests binding instead)
   - No two free-floating text elements overlap
7. **Stylistic audit (SOFT — advisory warnings, never blocks the build).** Lives in `audit.ts`. Currently:
   - **Label density.** Bound labels that fill <35% of their container's inner width (catches "label floating in a sea of empty space" — the failure mode where an explicit width was set way too large for the content). Skip tiny containers where padding dominates.

   Warnings print to stderr with a `⚠` marker. They do NOT fail the build. They are signals that an explicit width could be omitted (auto-fit) or sized closer to the content. The agent decides whether to address them.
8. **Final render.** Re-launch the renderer with the autofitted skeleton; export `.excalidraw` + `.png` + `.svg`.

This four-stage validation pipeline keeps separation clean:
- **Structural** (step 2) = identity / refs / files. Hard errors.
- **Real-pixel hard** (step 6) = geometric correctness. Hard errors.
- **Stylistic audit** (step 7) = aesthetic-but-objective quality. Soft warnings.
- **Design critic** (Part 4) = aesthetic-and-judgmental quality. Mandatory gate.

The build does NOT enforce aesthetics beyond step 7's objective signals. Color choices, hierarchy, alignment, label wording — that's the critic's gate.

---

# Part 4 — The design critic (mandatory)

A rendered diagram has not shipped until the design critic returns `PASS`. The build is necessary but not sufficient. The critic enforces every quality dimension the tool deliberately doesn't.

## 4.1 Generate inspection crops

Critics inspect crops, not just the downsampled overview. For canvases larger than ~3000px in either dimension, a single full-canvas preview hides text-fitting bugs, alignment drift, and color issues that only show at full resolution.

```bash
bash .claude/skills/excalidraw/tools/sh/crops.sh \
  /path/to/diagram.png \
  /path/to/crops-dir
```

This produces five crops at ~1800px wide each:

- `overview.png` — downsampled full canvas (for the gestalt)
- `nw.png`, `ne.png`, `sw.png`, `se.png` — quadrants at native resolution
- `center.png` — middle 50%

For smaller canvases, the overview is enough.

## 4.2 Spawn the design critic

**The critic is a specialized subagent.** Spawn it via the `Agent` tool (subagent_type=`general-purpose`). Send the prompt below verbatim — its rigor is what makes the loop work.

The critic owns every aspect of design quality. There is no separate layout critic, semantic critic, or scenario critic — one critic, methodical, with a high bar.

### Critic prompt (send verbatim)

```
You are a senior diagram designer reviewing a rendered Excalidraw diagram
for shippability. Your only job is to identify problems precisely enough
that a peer can fix them on the first try.

You are NOT a flatterer. You are NOT a brainstormer. You DO NOT propose
new content. You are a meticulous design reviewer with a high bar.

INPUTS
  - User intent (in plain language): {USER_INTENT}
  - Current spec (JSON):             {SPEC_JSON}
  - Rendered overview PNG:           {OVERVIEW_PATH}
  - Quadrant crops:                  {NW_PATH}, {NE_PATH}, {SW_PATH}, {SE_PATH}
  - Center crop:                     {CENTER_PATH}

PROCEDURE — do every step in order. Do not skip ahead.

Step 1: Read the user intent. Restate it back to yourself in one sentence.

Step 2: Open the overview. Form a one-paragraph first impression of the
diagram's gestalt. Note the apparent reading order, the apparent focal
point, and any immediate sense of imbalance.

Step 3: Inspect each of the five crops (NW, NE, SW, SE, center) in order.
For each crop, examine:
  - Every text element. Is every character visible? Any clipping at edges?
    Any overflow into adjacent elements? Any label that wraps unexpectedly?
  - Every shape. Does it sit in clean alignment with its neighbors? Is its
    size proportionate to its conceptual weight? Is its fill / stroke
    distinguishable from its neighbors?
  - Every connector. Does it visibly start and end at the right shapes?
    Is the direction unambiguous? Does its label sit clearly on or beside
    it without colliding with anything?
  - Every region of negative space. Is the gutter consistent? Are any
    elements awkwardly close to each other or to the canvas edge?

Step 4: Evaluate against the eight quality dimensions below. For each
dimension, return one of:
  PASS — explicit one-line reason
  REVISE — specific feedback naming the element ids involved and the
           concrete spec change needed

  4.1 Composition. Does the layout have a clear visual hierarchy? Is the
      focal point in the right place? Is the diagram balanced across the
      canvas, or lopsided?
  4.2 Alignment & grid. Are shapes aligned on shared axes? Are columns
      and rows visually clean? No drift, no off-by-a-few-pixels.
  4.3 Spacing. Are gutters consistent? Adjacent elements not touching?
      No element clipped at the canvas edge?
  4.4 Typography. Is every label legible at the rendered scale? Is the
      casing convention applied uniformly within each tier? Are font
      sizes used purposefully (not random)?
  4.5 Color & contrast. Is the palette coherent? Do labels read against
      their fills (white on dark, dark on light)? Are colors used
      semantically (the same color means the same thing throughout)?
  4.6 Connectors. Does every arrow visibly touch its bound shapes? Are
      arrow directions correct relative to the data flow / dependency
      direction the user intended? Are edge labels readable and
      collision-free?
  4.7 Semantic accuracy. Does the diagram correctly represent the user
      intent? Missing concepts? Extra concepts? Wrong relationships?
      Mislabeled elements?
  4.8 Craft & polish. Would you put your name on this diagram in a
      production doc? Is there anything sloppy, half-finished, or
      out-of-place?

Step 5: Verdict.
  - If ALL eight dimensions PASS: return `PASS — <one-line summary>`.
  - If any returns REVISE: return `REVISE` followed by a numbered list
    of every issue, grouped by element id where applicable, each with
    the concrete spec change that would resolve it.

Format your REVISE list so a single re-edit pass fixes all issues. Be
specific — name x/y coordinates, fontSize values, color hex codes, and
element ids. Don't say "improve spacing"; say "increase y of #publish
from 160 to 200 to align with #ingest at y=240".

Do NOT soften feedback. Do NOT add caveats like "overall this looks
great". Either it ships or it needs concrete revision.
```

## 4.3 Iterate

If the critic returns `REVISE`:

1. Apply EVERY fix it lists. Do not partially address; the critic ran a thorough pass and the issues are real.
2. Re-run the build.
3. Re-generate crops if the canvas is large.
4. Re-run the critic.

**Cap at 3 iterations.** If round 3 still returns `REVISE`, the spec has a concept-level problem — likely the diagram is trying to do too much, or the visual grammar doesn't match the content. **Return a Pivot Recommendation** to the requesting party instead of an artifact: name the dimensions that kept failing and propose a concept change (e.g., "split this into two diagrams", "swap radial layout for vertical-flow", "drop the inner detail and reference a sibling diagram").

---

# Reference

- [`references/primitive-api.md`](references/primitive-api.md) — every primitive type, every field
- [`references/common-mistakes.md`](references/common-mistakes.md) — failures the build catches and how to avoid them
- [`references/design-quality.md`](references/design-quality.md) — what a finished diagram should look like
- [`references/templates/`](references/templates/) — seed `.excalidraw` files per scenario (legacy starters; not v1 primitive specs)

# Why a single design critic instead of three

The previous version of this skill ran three parallel critics (Layout, Semantics, Scenario-specific). Splitting the review into narrow lanes produced sharp feedback per lane but two structural failures: (1) issues at the intersection of lanes (e.g., a layout choice that creates a semantic ambiguity) fell through the cracks, and (2) the parallel critics individually softened — each one had narrower scope and felt safer rubber-stamping. A single critic with a high bar, methodical inspection of every crop, and explicit failure modes catches more in one pass and doesn't soften.

# Why cap at 3 iterations

A spec that fails the same dimensions three times is signaling a concept problem, not a spec-writing problem. The cap forces a Pivot Recommendation rather than token-burning rewrites that paper over a structural mismatch between intent and form.
