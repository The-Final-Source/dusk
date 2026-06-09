# Design Quality Reference

The bar every diagram must clear before shipping. Use this as your pre-render checklist and as the rubric the design critic enforces.

This describes what we WANT, not what we avoid — a positive picture of a finished diagram.

## 1. Contrast is bulletproof

Every label is readable against its container at a glance. Dark fills carry light text. Light fills carry dark text. Mid-tone fills (luminance 0.4 – 0.6) are avoided for shapes carrying important labels — no text color reads cleanly against them.

The agent picks the label color explicitly. As a working rule of thumb:

| Background luminance | Label color |
|---|---|
| < 0.4 (dark) | `#FFFFFF` or near-white |
| > 0.7 (light) | `#1E1E1E` or near-black |
| 0.4–0.7 (mid) | avoid as a primary-content background; if unavoidable, use white with a stroke |

WCAG AA (4.5:1 for normal text, 3:1 for large) is the floor. Aim higher when space allows.

## 2. Three visual tiers are obvious

A successful diagram has three clearly separated visual tiers:

| Tier | What lives here | How to read |
|---|---|---|
| **Primary** | Title, hub shapes, focal-point elements. The thing the eye lands on first. | Largest, boldest, highest contrast. |
| **Secondary** | Section labels, supporting shapes, captions, axis text. Supporting structure. | Medium weight, muted color, smaller. Lives near its primary element. |
| **Tertiary** | Cross-element arrows, frame labels, footnotes, attribution. Background context. | Thinnest strokes, lowest contrast, lightest weight. Visible only when sought. |

If two tiers compete for attention, one of them is sized or weighted wrong. The fix is usually to push the supporting tier further down — not to amplify the primary.

## 3. Breathing room is intentional

Whitespace is a design element. Shapes do not touch other shapes. Frames don't bleed into adjacent frames. Arrow labels don't crowd shape labels.

Concrete defaults at typical viewport sizes (1200–1920 wide):

- **Between adjacent shapes** (sibling boxes in a row or column): ≥ 60px gutter.
- **Between unrelated shape groups**: ≥ 120px gutter.
- **Between any text element and the nearest shape**: ≥ `fontSize` worth of clear space.
- **Between the canvas edge and the outermost element**: ≥ 5% of the larger viewport dimension.

A diagram that violates these is crowded. The fix is to widen the viewport, shrink the shapes, or reduce the element count — not to nudge things 5 pixels closer.

## 4. Color carries meaning

Every color choice answers the question "what does this color communicate?" Three jobs colors typically do:

- **Status / state.** A graded ramp (e.g., dark blue → light blue) communicating a single ordinal dimension.
- **Category / role.** A small set of distinct hues encoding membership (process step = blue, decision = yellow, terminal = grey).
- **Emphasis.** A high-contrast accent reserved for the focal point of the diagram (used once or twice, not five times).

A diagram with seven random colors looks accidental. Decide on a 3–5 color palette UP FRONT, write the hex values down, and use those exact values throughout. If a color doesn't have a job, leave it default.

## 5. Strokes are consistent

Stroke widths are restrained to a small predictable set — usually 1px and 2px.

- 1px for tertiary lines (background grid, faint connectors, frame outlines).
- 2px for primary boundaries (hub shape borders, important arrows).

`roughness: 0` for working-document and architecture diagrams (clean geometric lines). `roughness: 1` (default) for whiteboard / brainstorm / mindmap scenarios (hand-drawn). **Never mix `roughness` values in the same diagram** unless the contrast is itself meaningful.

## 6. Arrows are legible

Arrows are placed and routed so a viewer can trace them without effort.

- They start at the edge of the source shape and end at the edge of the target — not the centers (lower.ts clips automatically for shape-id-bound arrows).
- They do not pass through the interior of unrelated shapes.
- They do not cross over labels.
- When arrows would visually overlap, the diagram is restructured to reduce overlap.
- The most important arrows use the strongest stroke. Secondary arrows are thinner / dashed / lower opacity.

If you have more than ~3 arrows entering or leaving a single shape, the arrows have become noise. Either reduce the count, group related arrows, or move some relationships to a separate diagram or a "see also" text block.

## 7. Balanced composition

Visual weight is roughly distributed across the canvas. No quadrant abandoned, no quadrant overloaded. Title and legend have presence proportional to the canvas — on a 1600×900 viewport a 14px title is invisible; titles should occupy ~3–5% of the canvas height.

Symmetry is not required; balance is. If the right half of the diagram feels empty, either the layout needs to spread more evenly, or you have content missing.

## 8. Typography hierarchy

Type sizes step in clear increments. A typical scale for a working diagram at 1200–1920px wide:

| Use | Size |
|---|---|
| Title | 28–40px |
| Subtitle / description | 16–22px |
| Section / frame labels | 14–18px |
| Primary shape labels | 20–24px |
| Secondary shape labels | 14–18px |
| Tertiary annotations / captions | 12–14px |

Font family is consistent. `fontFamily: 2` (Excalidraw's Helvetica) for clean docs; `fontFamily: 1` (Virgil — hand-drawn) for whiteboards and mindmaps. Never mix families in the same diagram.

## 9. Casing is consistent within a tier

If your primary shape labels use Title Case ("Above Threshold"), every primary shape label uses Title Case. Don't have one labeled "above threshold" or "Above threshold". The same applies to secondary labels, captions, frame labels — each tier picks one convention.

## 10. Content is precise

- Labels use precise verbs: "publish", "validate", "drop". Not "manages", "handles", "deals with".
- Labels are noun phrases or short imperative phrases. They don't contain full sentences.
- Decision diamonds are written as yes/no questions ("Above Threshold?", not "Threshold Check").
- Arrow labels describe the data or trigger crossing the connector ("raw event", "validated", "fails"), not the relationship type.
- No abbreviations the viewer wouldn't recognize ("Authorization Server" not "auth-svr").

## How to use this doc

- **Before assembling a spec.** Scan §1–§3 and §6: confirm your design has answers for contrast, hierarchy, breathing room, and arrow routing.
- **During the critic loop.** The design critic mandate (in SKILL.md) maps directly to these ten sections. When the critic returns REVISE, map each piece of feedback to the rule it derives from.
- **When self-reviewing.** If you find yourself rationalizing why a rule doesn't apply here, you're probably wrong. The rules describe what works across the broad range of diagrams this skill produces.
