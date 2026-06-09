import { IntentSchema, type Intent } from "./intent.js";
import { migrateRawIntent } from "./migration.js";

/** Internal Result type for fallible operations. */
export type Result<T, E> = { success: true; value: T } | { success: false; error: E };

export type IntentIssue = { message: string; path: string };

export type IntentLoad =
  | { success: true; intent: Intent; warnings: string[] }
  | { success: false; errors: IntentIssue[]; warnings: string[] };

export type ParseIntentOptions = { expectedId?: string };

/**
 * Migrate + validate a raw intent object (e.g. parsed YAML) into a typed Intent.
 * When `expectedId` is supplied, also enforce the path-to-id rule.
 */
export function parseIntent(raw: unknown, options: ParseIntentOptions = {}): IntentLoad {
  const { value, warnings } = migrateRawIntent(raw);
  const result = IntentSchema.safeParse(value);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.join("."),
    }));
    return { success: false, errors, warnings };
  }
  const intent = result.data;
  if (options.expectedId !== undefined && intent.id !== options.expectedId) {
    return {
      success: false,
      warnings,
      errors: [{ message: `intent id "${intent.id}" does not match its path "${options.expectedId}"`, path: "id" }],
    };
  }
  return { success: true, intent, warnings };
}
