// Bundles src/renderer/main.tsx → src/renderer/dist/main.js using esbuild,
// so the static HTML page can load it via file:// without a dev server.
//
// Run via: pnpm run build-renderer
// Or:      npx tsx .claude/skills/excalidraw/tools/ts/src/build-renderer.ts

import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const entryPoint = join(__dirname, "renderer", "main.tsx");
const outFile = join(__dirname, "renderer", "dist", "main.js");

async function main(): Promise<void> {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    outfile: outFile,
    format: "iife",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    conditions: ["production", "browser", "default"],
    loader: {
      ".css": "css",
      ".woff2": "dataurl",
      ".woff": "dataurl",
      ".ttf": "dataurl",
      ".svg": "dataurl",
      ".png": "dataurl",
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    sourcemap: false,
    minify: false,
    logLevel: "info",
  });

  if (result.errors.length > 0) {
    console.error("esbuild errors:", result.errors);
    process.exit(1);
  }
  console.log(`renderer bundle written to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
