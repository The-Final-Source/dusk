/**
 * Phase-6 §5.1 — the "application source" predicate (design D4, provenance axis).
 *
 * This is the PROVENANCE classifier ONLY: which COMMITS must carry the full v9
 * trailer set. It is orthogonal to the coverage axis (governed by
 * `decoration.ignore`, enforced by the runtime) — a file can be trailer-exempt
 * yet coverage-required (e.g. `package.json` is `dusk init` scaffold for
 * provenance but carries a `package.json.intent` sidecar for coverage). This
 * module makes NO coverage claim; it only answers "must this file's commit carry
 * pipeline trailers?".
 *
 * Required (pipeline-produced, trailer-required): all runtime application source
 * AND all test bodies under the pyramid suffixes (`unit-tests`/`integration-tests`/
 * `e2e-tests`).
 *
 * Exempt (trailer-exempt scaffold — an explicit, enumerated, minimal allowlist):
 * the `dusk init` output; the stack-config files (`package.json`/`tsconfig`/
 * `vitest.config`/Drizzle config/docker-compose); generated migrations; and the
 * Vitest infra provisioning (`globalSetup` + the e2e app-boot helper + the
 * project-side Dusk vitest reporter).
 *
 * Fail-safe: an UNKNOWN path defaults to **required**. The trailer-exempt set can
 * only ever SHRINK what the auditor checks; defaulting unknowns to required means
 * a newly-introduced source path cannot silently launder hand-written code — it
 * is trailer-required until someone deliberately adds it to the allowlist.
 */

export type SourceClass = "required" | "exempt";

export type ClassifySourceResult = {
  classification: SourceClass;
  /** Which allowlist rule matched (for exempt), or the required-reason — for diagnostics. */
  reason: string;
};

/** Pyramid test-layer directory suffixes — a test BODY under any of these is trailer-required. */
export const PYRAMID_SUFFIXES = ["unit-tests", "integration-tests", "e2e-tests"] as const;

/** Normalize a repo-relative path: strip a leading `./`, collapse `\\` → `/`, drop a leading `/`. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * The trailer-EXEMPT scaffold allowlist (design D4). Each entry is a predicate
 * over the normalized repo-relative path. Order does not matter — any match means
 * exempt. Keep this set minimal and justified; anything NOT matched is required.
 */
const EXEMPT_RULES: ReadonlyArray<{ reason: string; match: (p: string, base: string) => boolean }> = [
  // --- Stack-config files (`dusk init` output / hand-authored scaffold). ---
  { reason: "package-manifest", match: (_p, base) => base === "package.json" },
  { reason: "lockfile", match: (_p, base) => /\.lock$|^pnpm-lock\.yaml$|^package-lock\.json$/.test(base) },
  { reason: "tsconfig", match: (_p, base) => /^tsconfig(\..+)?\.json$/.test(base) },
  { reason: "vitest-config", match: (_p, base) => /^vitest\.config\.[cm]?[jt]s$/.test(base) },
  { reason: "drizzle-config", match: (_p, base) => /^drizzle\.config\.[cm]?[jt]s$/.test(base) },
  { reason: "docker-compose", match: (_p, base) => /^docker-compose(\..+)?\.ya?ml$/.test(base) },
  { reason: "dockerfile", match: (_p, base) => base === "Dockerfile" || base === ".dockerignore" },
  { reason: "env-example", match: (_p, base) => /^\.env(\..+)?$/.test(base) || base === ".env.example" },
  { reason: "git-meta", match: (_p, base) => base === ".gitignore" || base === ".gitattributes" },

  // --- `dusk init` output (the `.ia/` scaffold + the project Dusk config). ---
  { reason: "dusk-init-ia-scaffold", match: (p) => p.startsWith(".ia/") },
  { reason: "dusk-init-config", match: (_p, base) => base === "dusk.config.json" || base === "dusk.config.ts" },
  { reason: "dusk-init-claude-scaffold", match: (p) => p.startsWith(".claude/") },

  // --- Generated migrations (Drizzle / SQL output is generated, not pipeline-authored). ---
  { reason: "generated-migration", match: (p) => /(^|\/)(drizzle|migrations)\//.test(p) },

  // --- Vitest infra provisioning (D8): globalSetup + e2e app-boot helper + project reporter. ---
  { reason: "vitest-global-setup", match: (_p, base) => /^global[._-]?setup\.[cm]?[jt]s$/i.test(base) },
  { reason: "e2e-app-boot-helper", match: (_p, base) => /^(app[._-]?boot|boot[._-]?app|test[._-]?app)\.[cm]?[jt]s$/i.test(base) },
  { reason: "dusk-vitest-reporter", match: (_p, base) => /dusk.*reporter\.[cm]?[jt]s$/i.test(base) || /reporter.*dusk\.[cm]?[jt]s$/i.test(base) },
];

/**
 * Classify a repo-relative source path on the PROVENANCE axis. A test body under
 * a pyramid suffix is always required (it proves P6-T3/T4 were Dusk-produced),
 * even if it would otherwise look like config. Otherwise the exempt allowlist is
 * consulted; an unmatched path defaults to required (fail-safe).
 */
export function classifyApplicationSource(path: string): ClassifySourceResult {
  const p = normalizePath(path);
  const segments = p.split("/");
  const base = segments[segments.length - 1] ?? p;

  // Pyramid test bodies are trailer-required regardless of any exempt rule —
  // they ARE the proof the pipeline produced the tests (D4).
  for (const suffix of PYRAMID_SUFFIXES) {
    if (segments.includes(suffix)) {
      return { classification: "required", reason: `pyramid-test-body:${suffix}` };
    }
  }

  for (const rule of EXEMPT_RULES) {
    if (rule.match(p, base)) return { classification: "exempt", reason: rule.reason };
  }

  // Unknown → required (fail-safe). A path we have not explicitly exempted must
  // prove its pipeline provenance.
  return { classification: "required", reason: "unmatched-defaults-required" };
}

/** Convenience boolean: true when the file's commit must carry the full v9 trailer set. */
export function isTrailerRequired(path: string): boolean {
  return classifyApplicationSource(path).classification === "required";
}
