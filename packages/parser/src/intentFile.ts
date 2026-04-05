import { readFile } from "node:fs/promises";

import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  ObligationSchema,
  RelationshipSchema,
  VerifiabilitySchema,
} from "@dusk/schema";

import type { ParseError, ParseResult } from "./errors.js";

// TODO: Replace local IntentSchema with import from @dusk/schema once IntentSchema is available (DUSK-prx-2f88b)

const IntentDecisionSchema = z.object({
  point: z.string().min(1),
  choice: z.string().min(1),
  rationale: z.string().optional(),
});

const IntentConstraintSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  obligation: ObligationSchema,
  negative: z.boolean().default(false),
  verifiability: VerifiabilitySchema.optional(),
  concern_hint: z.string().optional(),
  refs: z.array(z.string()).optional(),
});

const RelatesToSchema = z.object({
  target: z.string().min(1),
  relationship: RelationshipSchema,
  rationale: z.string().min(1),
  decision_required: z.boolean().default(false),
  decision_prompt: z.string().optional(),
});

const IntentSchema = z.object({
  id: z.string().min(1),
  scope: z.string().min(1),
  adopts: z.array(z.string().min(1)),
  decisions: z.array(IntentDecisionSchema).optional().default([]),
  relates_to: z.array(RelatesToSchema).optional().default([]),
  constraints: z.array(IntentConstraintSchema).optional().default([]),
});

export type Intent = z.infer<typeof IntentSchema>;

export const parseIntentFile = (
  content: string,
  filePath?: string,
): ParseResult<Intent> => {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    return {
      success: false,
      errors: [
        {
          path: [],
          message: err instanceof Error ? err.message : "Invalid YAML",
          code: "YAML_PARSE_ERROR",
          file: filePath,
        },
      ],
    };
  }

  const result = IntentSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: ParseError[] = result.error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
    code: issue.code,
    file: filePath,
  }));

  return { success: false, errors };
};

export const writeIntentFile = (intent: Intent): string => {
  return stringifyYaml(intent, { lineWidth: 120 });
};

export const readIntentFile = async (
  path: string,
): Promise<ParseResult<Intent>> => {
  try {
    const content = await readFile(path, "utf-8");
    return parseIntentFile(content, path);
  } catch (err) {
    return {
      success: false,
      errors: [
        {
          path: [],
          message: err instanceof Error ? err.message : "Failed to read file",
          code: "FILE_READ_ERROR",
          file: path,
        },
      ],
    };
  }
};
