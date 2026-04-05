import { readFile } from "node:fs/promises";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { BlockSchema, type Block } from "@dusk/schema";

import type { ParseResult, ParseError } from "./errors.js";

export const parseBlockFile = (
  content: string,
  filePath?: string,
): ParseResult<Block> => {
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

  const result = BlockSchema.safeParse(raw);
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

export const writeBlockFile = (block: Block): string => {
  return stringifyYaml(block, { lineWidth: 120 });
};

export const readBlockFile = async (
  path: string,
): Promise<ParseResult<Block>> => {
  try {
    const content = await readFile(path, "utf-8");
    return parseBlockFile(content, path);
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
