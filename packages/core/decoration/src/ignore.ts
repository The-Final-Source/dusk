/**
 * The `decoration.ignore` glob matcher — the primitive behind the single ignore
 * SSoT (design D5). `DEFAULT_DECORATION_IGNORE` is the honest boundary of "total"
 * coverage: what it lists is what "every file" does *not* mean. The merge with a
 * project's `dusk.config.yml` additions lives in `@dusk/core-schema`
 * (`loadIgnoreGlobs`); this module is the pure matcher consumed identically by the
 * shared scanner, the gate, and `dusk doctor` so they can never disagree on what
 * is exempt. It replaces the three divergent hardcoded `SKIP_DIRS` (board M2).
 */

/** Built-in defaults, grouped (so the silent exemptions are explicit, not buried). */
export const DEFAULT_DECORATION_IGNORE: readonly string[] = [
  // dependencies — `**/<dir>/**` prunes the dir AND its contents at ANY depth.
  // A root-anchored `node_modules/**` misses a monorepo's nested
  // `packages/*/node_modules`, whose pnpm `.pnpm` symlink cycles hang the walk.
  "**/node_modules/**",
  "**/.git/**",
  // generated / build output (also pruned at any depth)
  ".ia/runtime/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/*.lock",
  // secrets
  ".env*",
];

/** Merge the built-in defaults with a project's `dusk.config.yml` additions — the single ignore SSoT. */
export function loadIgnoreGlobs(config?: { decoration?: { ignore?: string[] } }): string[] {
  return [...DEFAULT_DECORATION_IGNORE, ...(config?.decoration?.ignore ?? [])];
}

const REGEX_SPECIAL = new Set(["\\", "^", "$", ".", "|", "+", "(", ")", "[", "]", "{", "}"]);

/** Translate one glob to a full-match regex source over a posix relative path. */
function globToRegExpSource(glob: string): string {
  // A trailing `/**` must match the directory itself AND everything under it,
  // so `node_modules/**` prunes the `node_modules` dir (not just its contents).
  if (glob.endsWith("/**")) return `${globToRegExpSource(glob.slice(0, -3))}(?:/.*)?`;

  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i += 1;
        if (glob[i + 1] === "/") {
          out += "(?:.*/)?";
          i += 1;
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (REGEX_SPECIAL.has(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return out;
}

export type IgnoreMatcher = (relPath: string) => boolean;

/**
 * Compile a glob set into a single matcher. A glob with no `/` matches the
 * basename at any depth (gitignore-style); a glob with a `/` matches the full
 * relative path. The matcher answers for both files and directories — a
 * directory `node_modules` matches `node_modules/**` and is pruned during the
 * walk before descending.
 */
export function createIgnoreMatcher(globs: readonly string[]): IgnoreMatcher {
  const full: RegExp[] = [];
  const base: RegExp[] = [];
  for (const glob of globs) {
    const re = new RegExp(`^${globToRegExpSource(glob)}$`);
    (glob.includes("/") ? full : base).push(re);
  }
  return (relPath: string): boolean => {
    const normalized = relPath.split("\\").join("/").replace(/^\.\//, "");
    if (full.some((re) => re.test(normalized))) return true;
    const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
    return base.some((re) => re.test(basename));
  };
}
