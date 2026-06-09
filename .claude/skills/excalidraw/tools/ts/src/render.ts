// Playwright-driven export pipeline.
//
// Two entry points:
//   - measureSkeleton(skeleton): runs convertToExcalidrawElements in
//     the browser and returns actual computed dimensions for every
//     element + bound label. No export. Used by the build pipeline as
//     ground truth for auto-fit and validation.
//   - renderDiagram(skeletonOutput, options): full pipeline — convert
//     + export PNG/SVG/.excalidraw to disk.
//
// Both share a single Playwright session helper so the renderer page +
// bundle are loaded exactly once per call. The build pipeline calls
// measureSkeleton, then auto-fits and validates on Node side, then
// calls renderDiagram with the final skeleton.

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { chromium, type ConsoleMessage, type Page } from "playwright";

import type { SkeletonOutput } from "./skeleton.js";

export interface RenderFiles {
  [fileId: string]: {
    id: string;
    dataURL: string;
    mimeType: string;
    created: number;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RENDERER_DIR = resolve(__dirname, "renderer");
const RENDERER_HTML = join(RENDERER_DIR, "index.html");
const RENDERER_BUNDLE = join(RENDERER_DIR, "dist", "main.js");
const BUILD_RENDERER_SCRIPT = resolve(__dirname, "build-renderer.ts");

// ---- Measurement API ------------------------------------------------

export interface ElementMeasurement {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundLabelMeasurement {
  text: string;
  fontSize: number;
  width: number;
  height: number;
}

export interface Measurements {
  /** Keyed by element id. */
  measurements: Record<string, ElementMeasurement>;
  /** Keyed by the container shape's id. */
  boundLabels: Record<string, BoundLabelMeasurement>;
}

export interface MeasureOptions {
  rebuildRenderer?: boolean;
  timeoutMs?: number;
}

export async function measureSkeleton(
  skeleton: Record<string, unknown>[],
  options: MeasureOptions = {},
): Promise<Measurements> {
  return withPage(options.rebuildRenderer ?? false, options.timeoutMs ?? 30_000, async (page) => {
    const result = await page.evaluate(
      async (input) => {
        try {
          const out = await (
            window as unknown as {
              excalidrawAPI: { measure: (i: unknown) => Promise<Measurements> };
            }
          ).excalidrawAPI.measure(input);
          return out;
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) } as unknown as Measurements;
        }
      },
      { skeleton },
    );
    if ("error" in result) {
      throw new Error(`measure failed: ${(result as { error: string }).error}`);
    }
    return result;
  });
}

// ---- Render API -----------------------------------------------------

export interface RenderOptions {
  outputDir: string;
  basename?: string; // default: "diagram"
  rebuildRenderer?: boolean;
  timeoutMs?: number;
  files?: RenderFiles;
}

export interface RenderArtifacts {
  excalidrawPath: string;
  svgPath: string;
  pngPath: string;
}

export async function renderDiagram(
  skeletonOutput: SkeletonOutput,
  options: RenderOptions,
): Promise<RenderArtifacts> {
  const basename = options.basename ?? "diagram";

  await mkdir(options.outputDir, { recursive: true });

  const excalidrawPath = join(options.outputDir, `${basename}.excalidraw`);
  const svgPath = join(options.outputDir, `${basename}.svg`);
  const pngPath = join(options.outputDir, `${basename}.png`);

  await withPage(
    options.rebuildRenderer ?? false,
    options.timeoutMs ?? 30_000,
    async (page) => {
      const result = await page.evaluate(
        async (input) => {
          try {
            type RenderResponse = {
              svg?: string;
              pngBase64?: string;
              excalidrawJson?: string;
              error?: string;
            };
            return (await (
              window as unknown as { excalidrawAPI: { render: (i: unknown) => Promise<RenderResponse> } }
            ).excalidrawAPI.render(input)) as RenderResponse;
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }
        },
        {
          skeleton: skeletonOutput.skeleton,
          appState: skeletonOutput.appState,
          viewport: skeletonOutput.viewport,
          files: options.files ?? {},
        },
      );
      if ("error" in result) {
        throw new Error(`render failed: ${(result as { error: string }).error}`);
      }
      const { svg, pngBase64, excalidrawJson } = result as {
        svg: string;
        pngBase64: string;
        excalidrawJson: string;
      };
      if (!excalidrawJson || !svg || !pngBase64) {
        throw new Error("Renderer returned an incomplete result");
      }
      await writeFile(excalidrawPath, excalidrawJson, "utf-8");
      await writeFile(svgPath, svg, "utf-8");
      await writeFile(pngPath, Buffer.from(pngBase64, "base64"));
    },
    { width: Math.round(skeletonOutput.viewport.width), height: Math.round(skeletonOutput.viewport.height) },
  );

  return { excalidrawPath, svgPath, pngPath };
}

// ---- Shared Playwright session helper -------------------------------

async function withPage<T>(
  rebuild: boolean,
  timeoutMs: number,
  fn: (page: Page) => Promise<T>,
  viewport?: { width: number; height: number },
): Promise<T> {
  await ensureRendererBundle(rebuild);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: viewport ?? { width: 1024, height: 768 },
    });
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    let pageErrorMessage: string | null = null;
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrorMessage = err.message;
    });

    await page.goto(pathToFileURL(RENDERER_HTML).toString(), {
      waitUntil: "load",
      timeout: timeoutMs,
    });

    await page.waitForFunction(
      () => Boolean((window as unknown as { excalidrawAPI?: unknown }).excalidrawAPI),
      { timeout: timeoutMs },
    );

    const result = await fn(page);

    if (pageErrorMessage) {
      throw new Error(
        `Renderer page error: ${pageErrorMessage}\nConsole errors:\n${consoleErrors.join("\n")}`,
      );
    }

    return result;
  } finally {
    await browser.close();
  }
}

async function ensureRendererBundle(force: boolean): Promise<void> {
  if (!force) {
    try {
      await access(RENDERER_BUNDLE);
      return;
    } catch {
      // fall through
    }
  }

  console.error("[render] building renderer bundle…");
  await new Promise<void>((resolveBuild, rejectBuild) => {
    const child = spawn("npx", ["tsx", BUILD_RENDERER_SCRIPT], {
      stdio: "inherit",
      cwd: resolve(__dirname, ".."),
    });
    child.on("error", rejectBuild);
    child.on("exit", (code) => {
      if (code === 0) resolveBuild();
      else rejectBuild(new Error(`build-renderer exited with code ${code}`));
    });
  });
}
