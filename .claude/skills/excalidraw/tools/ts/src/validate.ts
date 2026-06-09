// Structural validation of a primitive Spec.
//
// Runs BEFORE rendering, on the agent-authored spec, to catch the kinds
// of errors that don't need a render pass: bad refs, missing required
// fields, duplicate ids, missing image files.
//
// Real-pixel checks (text-in-viewport, label-fit-in-container, text-shape
// overlap) live in autofit.ts and use the actual Excalidraw renderer for
// measurement, not approximations.

import { access } from "node:fs/promises";
import { resolve } from "node:path";

import type { Element, Spec } from "./spec.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface ValidationContext {
  /** Directory the spec was loaded from (for resolving image.src). */
  specDir: string;
}

export async function validateSpec(spec: Spec, ctx: ValidationContext): Promise<ValidationResult> {
  const errors: string[] = [];

  // Pass 1: ids + per-element required fields.
  const idToElement = new Map<string, Element>();
  for (const el of spec.elements) {
    const fieldErrors = checkRequiredFields(el);
    errors.push(...fieldErrors);

    const id = "id" in el ? el.id : undefined;
    if (id) {
      if (idToElement.has(id)) {
        errors.push(`Duplicate element id "${id}".`);
      } else {
        idToElement.set(id, el);
      }
    }
  }

  // Pass 2: cross-element references.
  for (const el of spec.elements) {
    switch (el.type) {
      case "arrow":
      case "line":
        if (typeof el.from === "string" && !idToElement.has(el.from)) {
          errors.push(`${el.type}${el.id ? ` "${el.id}"` : ""}: from references unknown shape id "${el.from}".`);
        }
        if (typeof el.to === "string" && !idToElement.has(el.to)) {
          errors.push(`${el.type}${el.id ? ` "${el.id}"` : ""}: to references unknown shape id "${el.to}".`);
        }
        break;
      case "frame":
        if (el.children) {
          for (const childId of el.children) {
            if (!idToElement.has(childId)) {
              errors.push(`frame "${el.id}": child id "${childId}" not found in elements[].`);
            }
          }
        }
        break;
      case "image": {
        const abs = resolve(ctx.specDir, el.src);
        try {
          await access(abs);
        } catch {
          errors.push(`image${el.id ? ` "${el.id}"` : ""}: src file not found at ${abs}`);
        }
        break;
      }
      default:
      // No cross-reference checks needed for the remaining types here.
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---- Required fields ------------------------------------------------

function checkRequiredFields(el: Element): string[] {
  const errors: string[] = [];
  const label = elementLabel(el);
  switch (el.type) {
    case "rectangle":
    case "ellipse":
    case "diamond":
      if (!el.id) errors.push(`${label}: id is required.`);
      requireNumber(el, "x", label, errors);
      requireNumber(el, "y", label, errors);
      // width and height are optional (auto-fit). lower.ts errors if both
      // are omitted AND no label is present.
      break;
    case "arrow":
    case "line":
      if (el.from === undefined) errors.push(`${label}: from is required (shape id or {x,y}).`);
      if (el.to === undefined) errors.push(`${label}: to is required (shape id or {x,y}).`);
      break;
    case "text":
      requireNumber(el, "x", label, errors);
      requireNumber(el, "y", label, errors);
      if (typeof el.text !== "string") errors.push(`${label}: text must be a string.`);
      break;
    case "freedraw":
      requireNumber(el, "x", label, errors);
      requireNumber(el, "y", label, errors);
      if (!Array.isArray(el.points) || el.points.length === 0) {
        errors.push(`${label}: points must be a non-empty array of [x,y] tuples.`);
      }
      break;
    case "frame":
      if (!el.id) errors.push(`${label}: id is required.`);
      if (!el.children && (el.x === undefined || el.y === undefined || el.width === undefined || el.height === undefined)) {
        errors.push(`${label}: provide either children[] (auto-fit) or x/y/width/height (explicit).`);
      }
      break;
    case "image":
      if (typeof el.src !== "string") errors.push(`${label}: src must be a string path.`);
      requireNumber(el, "x", label, errors);
      requireNumber(el, "y", label, errors);
      requireNumber(el, "width", label, errors);
      requireNumber(el, "height", label, errors);
      break;
    case "embeddable":
    case "iframe":
      if (typeof el.link !== "string") errors.push(`${label}: link must be a string URL.`);
      requireNumber(el, "x", label, errors);
      requireNumber(el, "y", label, errors);
      requireNumber(el, "width", label, errors);
      requireNumber(el, "height", label, errors);
      break;
  }
  return errors;
}

function requireNumber<T extends object>(el: T, key: string, label: string, errors: string[]): void {
  if (typeof (el as Record<string, unknown>)[key] !== "number") {
    errors.push(`${label}: ${key} is required (number).`);
  }
}

function elementLabel(el: Element): string {
  const id = "id" in el && el.id ? ` "${el.id}"` : "";
  return `${el.type}${id}`;
}
