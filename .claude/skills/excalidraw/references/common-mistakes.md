# Common Authoring Mistakes

Failures the build pipeline catches or the design critic flags repeatedly. Each one is a 60-second read and a one-line fix. Skim before writing a spec; revisit when the critic returns `REVISE`.

## 1. Text bleeding off the canvas

The most common failure. A `text` element has fixed `x` and the string is longer than the viewport allows from that `x`. The text gets rendered but the right side is clipped — the build's text-fit gate catches this **for free-floating text**.

**Symptom (build error):** `text at (60, 40) "Building Software via I…": extends 320px past the right edge of the viewport.`

**Fix:**
- Reduce `fontSize`, OR
- Move `x` left, OR
- Set `width` explicitly to constrain wrap, OR
- Widen the viewport.

For titles that should never wrap: leave `width` omitted, choose a `fontSize` such that the natural width at the chosen `x` is inside `viewport.width`. The error message gives you the exact pixel overflow so the math is mechanical.

## 2. Label too big for its container

A `rectangle`/`ellipse`/`diamond` has a `label` that Excalidraw wraps to more lines than fit in the container's inner height. The build catches this using the actual Excalidraw renderer's measurement, so the wrap math is accurate (not approximated).

**Symptom (build error):** `shape "decide" label "Above Threshold?" at fontSize 24: label wraps to 88px tall but container inner height is only 60px. Increase the shape's height, widen it so the label fits on fewer lines, or shrink fontSize.`

**Best fix:** OMIT `width` and `height` on labelled shapes and let the tool auto-size them to the label. The agent shouldn't be doing pixel arithmetic to fit text — the tool measures the real font and sizes the container.

**Alternative fixes:** widen the container, shrink the font, or shorten the label.

## 3. Free-floating text on top of a shape

A free-floating `text` element is NOT a label bound to a shape. It's a standalone string with its own bounding box. If you position it where a shape sits, the build's real-pixel overlap detection rejects the spec.

**Symptom (build error):** `text "caption" overlaps shape "container". text bbox = (200,100)..(540,140); shape bbox = (180,80)..(580,300). Move the text so it doesn't sit on top of the shape, OR bind the caption to the shape via the shape's "label" field.`

**Best fix:** If the text is conceptually a label for the shape, put it in the shape's `label` field (binds to the shape, stays attached in the editor). If it's a separate caption that just happens to be near the shape, move it outside the shape's bounding box.

## 4. Arrows referencing nonexistent shape ids

The build catches this. Typically a typo or a half-renamed id.

**Symptom (build error):** `arrow "edge-1": from references unknown shape id "step-on".`

**Fix:** grep the spec for the id; correct the typo.

## 5. Frames in the middle of `elements[]`

You can put `frame` primitives anywhere in `elements[]` — the lower pipeline always emits frames first in the rendered z-order so they draw underneath. But put related primitives near each other in the array anyway; future-you reading the spec benefits from locality.

## 6. Mixed casing inside a typography tier

The build does NOT enforce this; the design critic does. If your title is "Building Software via Intent" (Title Case) and a sibling title is "An overview of the system" (sentence case), the critic will flag it. Pick one convention per tier (title/header/body) and apply uniformly.

## 7. Hex colors used inconsistently

The build does NOT enforce this; the design critic does. If `#1E4B8C` and `#1F4B8B` both appear in your spec, they're functionally the same color but the noise tells the critic you weren't paying attention. Define a small palette (3–5 colors) at the top of your authoring process and reuse those exact hex values.

## 8. Arrows with absolute endpoints when you wanted bindings

`{ "from": "shape-1", "to": "shape-2" }` binds the arrow to the shapes — dragging either shape in the editor moves the arrow with it.

`{ "from": { "x": 100, "y": 200 }, "to": { "x": 400, "y": 200 } }` is a free-floating line at fixed pixels.

If you wanted the arrow to attach to a shape, use the id form. The build doesn't second-guess; the editor experience will be wrong if you mix them up.

## 9. Forgetting `$$primitiveVersion`

```jsonc
{ "$$primitiveVersion": 1, ... }
```

Required. Missing it errors with `spec.$$primitiveVersion must be 1; got undefined`. Add it at the top.

## 10. Image paths relative to the wrong directory

`image.src` resolves **relative to the spec file's directory**, not the project root and not the `--out` directory. Drop the image asset next to the spec file or use an absolute path.

## 11. Too many fonts or sizes

A diagram with `fontSize` values of 28, 26, 22, 20, 18, 16, 14, 12 looks accidentally varied. The viewer can't tell which size means what. Stick to 2–3 sizes representing distinct tiers (title / section header / body / caption). The critic will flag tier-mixing.

## 12. Sketchy strokes for production-looking diagrams

`roughness: 1` (default) gives the Excalidraw hand-drawn look. `roughness: 0` gives clean geometric strokes. Pick one for the whole diagram. If half your shapes are sketchy and half are geometric, the result looks broken.

## 13. Treating frames as background-tinted regions

The `frame` primitive renders as a thin-stroke rectangle, NO fill. If you want a tinted region behind a cluster of shapes, use a `rectangle` with `backgroundColor: "#F5F5F0"` (or similar) and `roughness: 0`. The frame primitive is for visual grouping with a corner label, not for color zoning.

## 14. Skipping the pre-render checklist

The SKILL.md has a Pre-Render Checklist. Working through it costs ~2 minutes and catches most issues before the build runs. Skipping it is the #1 reason a diagram requires three rounds of critic-driven rewrites.
