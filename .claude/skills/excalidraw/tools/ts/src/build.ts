// CLI orchestrator for the excalidraw skill.
//
// Pipeline (now stripped to essentials):
//   1. Read spec JSON
//   2. buildSkeleton(spec)
//      a. parseSpec — shape check + version gate
//      b. validateSpec — structural checks (ids, bindings, frame children,
//         image src files, text-in-viewport, label-in-container)
//      c. lower — emit Excalidraw skeleton + files map
//   3. renderDiagram — Playwright export → .excalidraw + .svg + .png
//
// Exits non-zero on any failure with the error list on stderr. No
// aesthetic gates — the agent owns composition; the design-critic loop
// (see SKILL.md) is where polish gets enforced.
//
// Usage (preferred — via the bash wrapper):
//   bash .claude/skills/excalidraw/tools/sh/build.sh \
//     --spec path/to/spec.json \
//     --out path/to/output-dir \
//     [--basename diagram] \
//     [--rebuild-renderer]

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { renderDiagram } from "./render.js";
import { buildSkeleton } from "./skeleton.js";

interface Flags {
  spec?: string;
  out?: string;
  basename?: string;
  rebuildRenderer: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { rebuildRenderer: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--spec":
        flags.spec = argv[++i];
        break;
      case "--out":
        flags.out = argv[++i];
        break;
      case "--basename":
        flags.basename = argv[++i];
        break;
      case "--rebuild-renderer":
        flags.rebuildRenderer = true;
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          fatal(`Unknown flag: ${arg}`);
        }
    }
  }
  return flags;
}

function printUsage(): void {
  console.log(`Usage:
  bash .claude/skills/excalidraw/tools/sh/build.sh \\
    --spec path/to/spec.json \\
    --out path/to/output-dir \\
    [--basename diagram] \\
    [--rebuild-renderer]

Outputs:
  <out>/<basename>.excalidraw   Editable Excalidraw file
  <out>/<basename>.svg          Vector export
  <out>/<basename>.png          Raster export (1x scale)`);
}

function fatal(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.spec) fatal("missing --spec <path>");
  if (!flags.out) fatal("missing --out <dir>");

  const specPath = resolve(process.cwd(), flags.spec!);
  const specDir = dirname(specPath);

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(specPath, "utf-8"));
  } catch (e) {
    fatal(`failed to load spec from ${specPath}: ${(e as Error).message}`);
  }

  console.error(`[build] parsing + validating ${specPath}`);
  let skeletonOutput;
  try {
    skeletonOutput = await buildSkeleton(raw, {
      specDir,
      rebuildRenderer: flags.rebuildRenderer,
    });
  } catch (e) {
    fatal((e as Error).message);
  }

  // Advisory audit warnings from audit.ts. Printed to stderr, never block.
  if (skeletonOutput.warnings.length > 0) {
    console.error(`[build] ${skeletonOutput.warnings.length} audit warning(s) — advisory, not blocking:`);
    for (const w of skeletonOutput.warnings) {
      console.error(`  ⚠ ${w}`);
    }
  }

  console.error(`[build] rendering (${skeletonOutput.skeleton.length} elements)`);
  const artifacts = await renderDiagram(skeletonOutput, {
    outputDir: resolve(process.cwd(), flags.out!),
    basename: flags.basename,
    rebuildRenderer: flags.rebuildRenderer,
    files: skeletonOutput.files,
  });

  console.log(JSON.stringify(artifacts, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
