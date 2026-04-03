import { readFile } from "node:fs/promises";

import { CompositionAuditSchema, type CompositionAudit } from "@dusk/schema";

import type { ParseResult, ParseError } from "./errors.js";

export const parseAuditFile = (
  content: string,
  filePath?: string,
): ParseResult<CompositionAudit> => {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    return {
      success: false,
      errors: [
        {
          path: [],
          message: err instanceof Error ? err.message : "Invalid JSON",
          code: "JSON_PARSE_ERROR",
          file: filePath,
        },
      ],
    };
  }

  const result = CompositionAuditSchema.safeParse(raw);
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

export const writeAuditFile = (audit: CompositionAudit): string => {
  return JSON.stringify(audit, null, 2) + "\n";
};

export const readAuditFile = async (
  path: string,
): Promise<ParseResult<CompositionAudit>> => {
  try {
    const content = await readFile(path, "utf-8");
    return parseAuditFile(content, path);
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
