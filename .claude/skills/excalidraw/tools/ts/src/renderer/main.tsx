// Excalidraw renderer entry. Bundled by build-renderer.ts into
// dist/main.js, loaded by index.html via Playwright (file://).
//
// Exposes two APIs on window.excalidrawAPI:
//
//   measure({ skeleton }) → { measurements }
//     Runs convertToExcalidrawElements on the skeleton (without exporting)
//     and returns the actual computed x/y/width/height for every element
//     with an id, plus any bound label dimensions keyed by containerId.
//     Node uses this as ground truth for auto-fit + validation.
//
//   render({ skeleton, appState, viewport, files }) → { svg, pngBase64, excalidrawJson }
//     Full pipeline: convert + export to SVG/PNG/.excalidraw.
//
// All Excalidraw runtime calls happen here (browser-side). Node side only
// orchestrates I/O and decides whether to render based on measurements.

import {
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
} from "@excalidraw/excalidraw";

import "@excalidraw/excalidraw/index.css";

interface MeasureInput {
  skeleton: unknown[];
}

interface ElementMeasurement {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Set on text elements that Excalidraw bound to a container. */
  containerId?: string;
}

interface BoundLabelMeasurement {
  text: string;
  fontSize: number;
  /** Width of the bound label text after Excalidraw's word-wrap math. */
  width: number;
  /** Height of the bound label text (lines × line-height). */
  height: number;
}

interface MeasureOutput {
  /** Keyed by element.id from the input skeleton. */
  measurements: Record<string, ElementMeasurement>;
  /** Keyed by container element id (the shape that owns the label). */
  boundLabels: Record<string, BoundLabelMeasurement>;
}

interface RenderInput {
  skeleton: unknown[];
  appState: {
    viewBackgroundColor?: string;
    exportBackground?: boolean;
  };
  viewport: { width: number; height: number };
  files?: Record<string, {
    id: string;
    dataURL: string;
    mimeType: string;
    created: number;
  }>;
}

interface RenderOutput {
  svg: string;
  pngBase64: string;
  excalidrawJson: string;
}

declare global {
  interface Window {
    excalidrawAPI: {
      measure: (input: MeasureInput) => Promise<MeasureOutput>;
      render: (input: RenderInput) => Promise<RenderOutput>;
    };
  }
}

function setStatus(s: string): void {
  const el = document.getElementById("status");
  if (el) el.textContent = s;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

window.excalidrawAPI = {
  async measure({ skeleton }) {
    setStatus("measuring…");
    const elements = convertToExcalidrawElements(
      skeleton as Parameters<typeof convertToExcalidrawElements>[0],
      { regenerateIds: false },
    );

    const measurements: Record<string, ElementMeasurement> = {};
    const boundLabels: Record<string, BoundLabelMeasurement> = {};

    for (const el of elements) {
      if (el.id) {
        measurements[el.id] = {
          type: el.type,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
        };
      }
      // Bound labels: text elements with a containerId pointing at the
      // shape that owns them. Excalidraw populates this when a skeleton
      // shape carried a `label` field.
      if (el.type === "text" && "containerId" in el && el.containerId) {
        const textEl = el as { text: string; fontSize: number; width: number; height: number; containerId: string };
        boundLabels[textEl.containerId] = {
          text: textEl.text,
          fontSize: textEl.fontSize,
          width: textEl.width,
          height: textEl.height,
        };
      }
    }

    setStatus("ready");
    return { measurements, boundLabels };
  },

  async render({ skeleton, appState, viewport, files }) {
    setStatus("converting skeleton…");

    const elements = convertToExcalidrawElements(
      skeleton as Parameters<typeof convertToExcalidrawElements>[0],
      { regenerateIds: false },
    );

    const filesMap = files ?? {};
    const hasFiles = Object.keys(filesMap).length > 0;
    const filesArg = hasFiles ? (filesMap as unknown as Parameters<typeof exportToSvg>[0]["files"]) : null;

    setStatus("exporting svg…");

    const svgEl = await exportToSvg({
      elements,
      appState: {
        ...appState,
        exportBackground: appState.exportBackground ?? true,
        viewBackgroundColor: appState.viewBackgroundColor ?? "#FFFFFF",
        exportPadding: 24,
      },
      files: filesArg,
      exportPadding: 24,
    });

    const svg = new XMLSerializer().serializeToString(svgEl);

    setStatus("exporting png…");

    const pngBlob = await exportToBlob({
      elements,
      appState: {
        ...appState,
        exportBackground: appState.exportBackground ?? true,
        viewBackgroundColor: appState.viewBackgroundColor ?? "#FFFFFF",
      },
      files: filesArg,
      mimeType: "image/png",
      quality: 1,
    });

    const pngBase64 = await blobToBase64(pngBlob);

    setStatus("building .excalidraw json…");

    const excalidrawJson = JSON.stringify(
      {
        type: "excalidraw",
        version: 2,
        source: "dusk-excalidraw-skill",
        elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor ?? "#FFFFFF",
          gridSize: null,
        },
        files: filesMap,
      },
      null,
      2,
    );

    setStatus("done");
    void viewport;
    return { svg, pngBase64, excalidrawJson };
  },
};

setStatus("ready");
