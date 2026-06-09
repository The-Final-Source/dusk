/**
 * Forward-migrate an older raw intent object to the current schema shape, in place on a copy.
 * Deterministic, mechanical normalization — no validation here (that follows in `parseIntent`).
 * Returns the normalized object plus a deprecation warning per migrated construct.
 */
export type Migration = { value: Record<string, unknown>; warnings: string[] };

function migrateTripleNegation(list: unknown, warnings: string[]): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((triple) => {
    if (triple && typeof triple === "object" && "negated" in triple) {
      const { negated, ...rest } = triple as Record<string, unknown>;
      if (negated === true) {
        warnings.push(`migrated triple "${String((triple as Record<string, unknown>).id)}": negated → polarity: negative`);
        return { ...rest, polarity: "negative" };
      }
      return rest;
    }
    return triple;
  });
}

export function migrateRawIntent(raw: unknown): Migration {
  const warnings: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { value: { __invalid: raw }, warnings };
  }
  const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  if (obj.schema_version === 1) {
    warnings.push("migrated schema_version 1 → 2");
    obj.schema_version = 2;
  } else if (obj.schema_version === undefined) {
    obj.schema_version = 2;
  }

  if (Array.isArray(obj.relates_to)) {
    obj.relates_to = obj.relates_to.map((entry) => {
      if (typeof entry === "string") {
        warnings.push(`migrated flat relates_to "${entry}" → {kind: sibling}`);
        return { kind: "sibling", target: entry };
      }
      if (entry && typeof entry === "object" && (entry as Record<string, unknown>).kind === "refines") {
        const target = (entry as Record<string, unknown>).target;
        warnings.push(`migrated relates_to kind refines → parent (target ${String(target)})`);
        return { ...(entry as Record<string, unknown>), kind: "parent" };
      }
      return entry;
    });
  }

  for (const key of ["triples", "antecedent", "consequent"] as const) {
    if (key in obj) obj[key] = migrateTripleNegation(obj[key], warnings);
  }

  return { value: obj, warnings };
}
