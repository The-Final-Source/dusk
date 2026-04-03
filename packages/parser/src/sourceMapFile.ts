import { readFile } from "node:fs/promises";

import { SourceMapSchema, type SourceMap } from "@dusk/schema";

import type { ParseError, ParseResult } from "./errors.js";

export const parseSourceMapFile = (
  content: string,
  filePath?: string
): ParseResult<SourceMap> => {
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

  const result = SourceMapSchema.safeParse(raw);
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

export const writeSourceMapFile = (sourceMap: SourceMap): string => {
  return JSON.stringify(sourceMap, null, 2) + "\n";
};

export const readSourceMapFile = async (
  path: string
): Promise<ParseResult<SourceMap>> => {
  try {
    const content = await readFile(path, "utf-8");
    return parseSourceMapFile(content, path);
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
