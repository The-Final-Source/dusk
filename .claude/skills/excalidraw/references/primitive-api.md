# Primitive API Reference

The only thing the tool consumes. One JSON file, one `elements: []` array of Excalidraw primitives. No tokens, no decorations, no scales, no layouts, no auto-anything.

## Top-level spec

```jsonc
{
  "$$primitiveVersion": 1,          // required — version gate
  "viewport": {                     // required — output canvas size in px
    "width": 1600,
    "height": 900
  },
  "background": "#FFFFFF",          // optional — canvas background, defaults to white
  "elements": [                     // required — primitives in render order
    // earlier elements draw BEHIND later ones (z-order = array index)
  ]
}
```

The agent owns the viewport. Size it to fit the surface the diagram will live on (slide 1920×1080, doc 1200 wide, blog 800 wide). The renderer exports PNG/SVG at exactly the viewport dimensions.

## Element types

Every element has a `type` discriminator and the fields documented in the corresponding section below.

| Type | Purpose | Position via |
|---|---|---|
| [`rectangle`](#rectangle-ellipse-diamond) | Rectangular shape with optional label | x, y, width, height |
| [`ellipse`](#rectangle-ellipse-diamond) | Elliptical shape with optional label | x, y, width, height |
| [`diamond`](#rectangle-ellipse-diamond) | Diamond shape with optional label | x, y, width, height |
| [`arrow`](#arrow-line) | Directional connector | from, to (or x/points) |
| [`line`](#arrow-line) | Connector without arrowheads by default | from, to (or x/points) |
| [`text`](#text) | Free-floating text | x, y |
| [`freedraw`](#freedraw) | Hand-drawn stroke | x, y, points |
| [`frame`](#frame) | Visual container — drawn UNDER its children with a corner label | x, y, width, height OR children[] |
| [`image`](#image) | Embedded local image | x, y, width, height + src |
| [`embeddable`](#embeddable-iframe) | Embedded URL (YouTube, Spotify, etc.) | x, y, width, height + link |
| [`iframe`](#embeddable-iframe) | Generic iframe | x, y, width, height + link |

## rectangle, ellipse, diamond

```jsonc
{
  "type": "rectangle",              // or "ellipse" or "diamond"
  "id": "step-1",                   // required — referenced by arrows + frames
  "x": 100, "y": 200,               // required — top-left corner

  // width and height are OPTIONAL.
  //   - If both are omitted AND a label is present, the shape auto-fits
  //     to the label's actual rendered width/height + padding (32×24).
  //   - If you want a specific size, set them explicitly.
  //   - The build refuses a shape with no dimensions AND no label.
  "width": 220, "height": 120,

  // Style — all optional
  "strokeColor":     "#1E4B8C",
  "backgroundColor": "#E0E8F2",
  "fillStyle":       "solid",
  "strokeWidth":     2,
  "strokeStyle":     "solid",
  "roughness":       1,
  "opacity":         100,
  "roundness":       { "type": 3 },
  "angle":           0,

  // Optional bound label
  "label": "Step One"               // string shorthand → fontSize 20, dark default
  // OR
  "label": {
    "text":       "Step One",
    "fontSize":   24,
    "strokeColor": "#1E1E1E",
    "textAlign":  "center",
    "verticalAlign": "middle"
  }
}
```

**Recommended pattern: omit width/height when the shape has a label.** The tool measures the actual rendered label using Excalidraw's font and sizes the container to fit. You write the position and the content; the tool handles the geometry. This is the most reliable way to avoid label-wrapping or container-too-small bugs.

**Label fit is enforced with REAL measurements.** When you DO set width/height explicitly, the build measures the label at your fontSize using the actual Excalidraw renderer. If it would wrap to more lines than fit in the container's inner height, the build fails with a precise error showing the wrapped label height and the available inner height.

## arrow, line

```jsonc
{
  "type": "arrow",                  // or "line"
  "id": "edge-1",                   // optional

  // Endpoints — required. Two forms:
  "from": "step-1",                 // shape id: binds + auto-clips geometry to shape's edge
  "to":   "step-2",
  // OR
  "from": { "x": 100, "y": 200 },   // absolute point: no binding
  "to":   { "x": 400, "y": 200 },

  // Style — all optional
  "strokeColor":    "#444444",
  "strokeWidth":    2,
  "strokeStyle":    "solid",
  "roughness":      1,
  "opacity":        100,
  "startArrowhead": null,           // "arrow" | "bar" | "dot" | "triangle" | null
  "endArrowhead":   "arrow",        // arrow defaults to "arrow"; line defaults to null

  // Optional bound label
  "label": "calls"                  // string shorthand or object (same as shapes)
}
```

When `from` or `to` is a shape id:
- The connector binds to the shape (so the arrow stays attached when shapes are dragged in the Excalidraw editor).
- Initial geometry is computed by clipping the line from the shape's center to the shape's edge (axis-aligned box). Visual touches the border, not the center.

When `from` or `to` is an absolute point, no binding is recorded; the connector is free-floating.

## text

Free-floating text. **Not** a label bound to a shape — for that, use the `label` field on rectangle/ellipse/diamond/arrow.

```jsonc
{
  "type": "text",
  "id": "title",                    // optional
  "x": 60, "y": 40,                 // required — top-left corner
  "text": "Diagram Title",          // required

  "fontSize":     28,               // default 20
  "fontFamily":   2,                // 1=Virgil (hand-drawn), 2=Helvetica, 3=Cascadia. default 2
  "strokeColor":  "#1E1E1E",
  "textAlign":    "left",
  "verticalAlign":"top",
  "opacity":      100,
  "angle":        0,

  // Width/height are auto-computed if omitted — see "Text fit" below.
  "width":  600,                    // optional — when set, wraps at this width
  "height": 60                      // optional — when set, fixes vertical extent
}
```

### Text fit

The build **never lets a text element render off the canvas**, and uses Excalidraw's actual font measurement (not approximations) for the check.

| You provide | Excalidraw computes | Build validates |
|---|---|---|
| Just `text` + position | Natural width (longest line), natural height | x + measured width ≤ viewport.width |
| `text` + explicit `width` | Wrapped lines + height (lines × line-height) | Same — extends past edge → error |

After measurement, the build checks `x + width ≤ viewport.width` and `y + height ≤ viewport.height`. If either fails, the build refuses the spec with a precise message naming the overflow in pixels.

**Titles and labels should not wrap.** For a one-line title, leave `width` omitted. The measurement step reports the natural width; if it doesn't fit at the chosen `x`, the error tells you the exact overflow so you can shrink fontSize or move x.

## freedraw

Hand-drawn stroke. Useful for sketches, annotations, signatures, accents.

```jsonc
{
  "type": "freedraw",
  "id": "underline",                // optional
  "x": 60, "y": 720,                // required — element-local origin
  "points": [                       // required — at least one point
    [0, 0], [40, 2], [120, -3], [220, 1], [340, 4]
  ],
  // Points are RELATIVE to (x, y). First point is conventionally [0, 0].

  "strokeColor":    "#1E1E1E",
  "strokeWidth":    3,
  "opacity":        100,
  "pressures":      [0.5, 0.8, 1.0, 0.7],   // optional — per-point pressure 0–1
  "simulatePressure": false                  // default true
}
```

## frame

A visual container — drawn UNDER its children with a small text label at the top-left corner. Useful for grouping related shapes (swimlanes, zones, sections).

```jsonc
{
  "type": "frame",
  "id": "frame-cold-path",          // required — referenced for ordering
  "label": "Cold Path",             // optional — rendered as 14px text at top-left corner (x+12, y+8)

  // Bounds — provide EITHER explicit x/y/width/height OR children[] (auto-fit)
  "children": ["ingest", "process", "decide"],  // ids of shapes to bound
  "padding": 40,                    // default 16 — gutter between bound box and children

  // OR explicit bounds:
  "x": 60, "y": 200,
  "width": 1480, "height": 360
}
```

**What the frame primitive does:**

- Renders as a thin-stroke rectangle (rounded corners, gray stroke, no fill).
- Always emits BEFORE shapes/arrows/text in the rendered z-order so children float on top.
- If `label` is set, emits a separate `text` primitive at (frame.x + 12, frame.y + 8), 14px gray.
- Does NOT carry Excalidraw's editor-mode frame semantic (drag the frame, children follow). For static export this is the right call; for editor use, group children manually after opening the file.

## image

Embeds a local image. Loaded from disk, base64-encoded into the `.excalidraw` file.

```jsonc
{
  "type": "image",
  "id": "logo",                     // optional
  "src": "./logo.png",              // required — path RELATIVE TO THE SPEC FILE
  "x": 100, "y": 100,
  "width": 200, "height": 60,

  "opacity": 100,                   // optional
  "angle":   0                      // optional
}
```

Supported extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`. If `src` resolves to a missing file, the build fails before render.

## embeddable, iframe

For exotic cases — links to externally-rendered content. Excalidraw treats both the same; the distinction is convention. Most diagrams don't need these.

```jsonc
{
  "type": "embeddable",             // or "iframe"
  "id": "demo",
  "link": "https://youtube.com/watch?v=...",
  "x": 100, "y": 100,
  "width": 480, "height": 270,
  "opacity": 100
}
```

## Z-order

Render order is determined by `elements` array position: earlier = behind, later = in front. The lower pipeline applies one structural exception: **frames are emitted first**, then their corner labels, then all other content — regardless of where they sit in `elements[]`. This guarantees containers draw under their children.

If you need more precise control (e.g., a freedraw underline UNDER a text it underlines), put the freedraw earlier in the array.

## Validation (what the build refuses)

The build runs three phases. All errors are precise — they name the element id, the measured pixels, and the concrete fix.

### Structural (cheap, no rendering needed)

- `$$primitiveVersion` not `1`
- Missing required field per type
- Duplicate `id` values
- `arrow.from` or `.to` referencing an unknown shape id
- `frame.children` referencing an unknown id
- `image.src` resolving to a missing file

### Real-pixel measurement (runs Excalidraw to measure)

- Any element extending past viewport bounds (top/left/right/bottom) — reports measured overflow in pixels
- A shape with a `label` whose container is too small (wrapped label height > container inner height at the requested fontSize) — reports wrapped height and available height
- A free-floating `text` element overlapping any shape — reports both bounding boxes and suggests binding the caption to the shape instead
- A free-floating `text` element overlapping another `text` element — reports both ids

### What the build does NOT enforce

- Alignment, hierarchy, color choice, label wording, visual balance — the design critic's gate.
- Arrow routing (whether an arrow visibly crosses unrelated shapes) — also the design critic.
