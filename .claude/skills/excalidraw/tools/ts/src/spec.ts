// Primitive spec types.
//
// The tool's only job is to render an array of Excalidraw primitives.
// The format is a thin wrapper over Excalidraw's own element format with
// a handful of ergonomic shortcuts (label-as-string, arrow from/to).
// No tokens, decorations, scales, layouts, defaults, or text policies.
// The agent owns every position, size, color, label, and fontSize.

export const SPEC_VERSION = 1;

export interface Spec {
  $$primitiveVersion: 1;
  /** Output canvas size. Required; the agent sizes the viewport for the content. */
  viewport: { width: number; height: number };
  /** Canvas background hex. Defaults to "#FFFFFF". */
  background?: string;
  elements: Element[];
}

export type Element =
  | Rectangle
  | Ellipse
  | Diamond
  | Arrow
  | Line
  | Text
  | Freedraw
  | Frame
  | Image
  | Embeddable
  | Iframe;

// ---- Common ----------------------------------------------------------

export type Roundness = { type: 2 | 3 } | null;
export type FillStyle = "solid" | "hachure" | "cross-hatch" | "zigzag";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type ArrowHead = "arrow" | "bar" | "dot" | "triangle" | null;
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

/**
 * Bound text on a shape or arrow. As a string, uses fontSize 20, default
 * stroke. As an object, every field is explicit.
 */
export type Label =
  | string
  | {
      text: string;
      fontSize?: number;
      strokeColor?: string;
      textAlign?: TextAlign;
      verticalAlign?: VerticalAlign;
    };

interface ShapeBase {
  /** Required for any element that may be referenced by arrows or frames. */
  id: string;
  x: number;
  y: number;
  /**
   * Both width and height are OPTIONAL. If omitted (or both omitted) AND
   * `label` is present, the shape auto-fits to its label's actual rendered
   * width/height + padding. If you want a specific size, set them. The
   * build refuses a shape with no width AND no label (nothing to size to).
   */
  width?: number;
  height?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  /** 0 = sketch-free (geometric), 1 = default Excalidraw sketch, 2 = wobbly. */
  roughness?: 0 | 1 | 2;
  /** 0–100. */
  opacity?: number;
  /** Pass `{ type: 3 }` for fully-rounded corners on rectangles, `null` for sharp. */
  roundness?: Roundness;
  /** Radians. */
  angle?: number;
  label?: Label;
}

// ---- Shapes ----------------------------------------------------------

export interface Rectangle extends ShapeBase {
  type: "rectangle";
}
export interface Ellipse extends ShapeBase {
  type: "ellipse";
}
export interface Diamond extends ShapeBase {
  type: "diamond";
}

// ---- Connectors ------------------------------------------------------

export type Endpoint = string | { x: number; y: number };

interface ConnectorBase {
  id?: string;
  /** Either: element-id string (binds + auto-computes geometry), or {x,y} absolute point. */
  from: Endpoint;
  to: Endpoint;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  roughness?: 0 | 1 | 2;
  opacity?: number;
  startArrowhead?: ArrowHead;
  endArrowhead?: ArrowHead;
  /** Optional bound label. */
  label?: Label;
}

export interface Arrow extends ConnectorBase {
  type: "arrow";
  /** Default endArrowhead is "arrow"; pass null to omit. */
}

export interface Line extends ConnectorBase {
  type: "line";
  /** Default endArrowhead is null. */
}

// ---- Text ------------------------------------------------------------

export interface Text {
  type: "text";
  id?: string;
  x: number;
  y: number;
  text: string;
  /** Default 20. */
  fontSize?: number;
  /** Excalidraw font family: 1=Virgil (hand-drawn), 2=Helvetica, 3=Cascadia. Default 2. */
  fontFamily?: number;
  strokeColor?: string;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  /** When omitted, text grows freely. Set to constrain wrap width. */
  width?: number;
  height?: number;
  opacity?: number;
  angle?: number;
}

// ---- Freedraw --------------------------------------------------------

export interface Freedraw {
  type: "freedraw";
  id?: string;
  x: number;
  y: number;
  /** Points in element-local coordinates. First point is typically [0,0]. */
  points: Array<[number, number]>;
  pressures?: number[];
  simulatePressure?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
}

// ---- Frame -----------------------------------------------------------

export interface Frame {
  type: "frame";
  id: string;
  label?: string;
  /**
   * If `children` is provided, frame bounds auto-fit around the children +
   * `padding`. If `x`/`y`/`width`/`height` are all provided, those are used
   * verbatim and `children` is informational.
   */
  children?: string[];
  padding?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

// ---- Image -----------------------------------------------------------

export interface Image {
  type: "image";
  id?: string;
  /** Path to a local image file, relative to the spec file's directory. */
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  angle?: number;
}

// ---- Embeddable / Iframe ---------------------------------------------

export interface Embeddable {
  type: "embeddable";
  id?: string;
  link: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
}

export interface Iframe {
  type: "iframe";
  id?: string;
  link: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
}

// ---- Parse + light shape coercion ------------------------------------

/**
 * Parse a JSON object as a Spec. Performs only the most basic shape
 * checks; deeper structural validation (id uniqueness, binding integrity,
 * etc.) lives in validate.ts.
 */
export function parseSpec(raw: unknown): Spec {
  if (raw === null || typeof raw !== "object") {
    throw new Error("spec must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.$$primitiveVersion !== SPEC_VERSION) {
    throw new Error(
      `spec.$$primitiveVersion must be ${SPEC_VERSION}; got ${JSON.stringify(
        obj.$$primitiveVersion,
      )}. See references/primitive-api.md.`,
    );
  }
  if (typeof obj.viewport !== "object" || obj.viewport === null) {
    throw new Error("spec.viewport is required: { width, height }");
  }
  const vp = obj.viewport as Record<string, unknown>;
  if (typeof vp.width !== "number" || typeof vp.height !== "number") {
    throw new Error("spec.viewport.width and .height must be numbers");
  }
  if (!Array.isArray(obj.elements)) {
    throw new Error("spec.elements must be an array");
  }
  return {
    $$primitiveVersion: SPEC_VERSION,
    viewport: { width: vp.width, height: vp.height },
    background: typeof obj.background === "string" ? obj.background : undefined,
    elements: obj.elements as Element[],
  };
}
