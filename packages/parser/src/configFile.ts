import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";

import { IntentConfigSchema, type IntentConfig } from "@dusk/schema";

import type { ParseResult, ParseError } from "./errors.js";

export const parseConfigFile = (content: string, filePath?: string): ParseResult<IntentConfig> => {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    return {
      success: false,
      errors: [{
        path: [],
        message: err instanceof Error ? err.message : "Invalid YAML",
        code: "YAML_PARSE_ERROR",
        file: filePath,
      }],
    };
  }

  const result = IntentConfigSchema.safeParse(raw);
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

export const readConfigFile = async (path: string): Promise<ParseResult<IntentConfig>> => {
  try {
    const content = await readFile(path, "utf-8");
    return parseConfigFile(content, path);
  } catch (err) {
    return {
      success: false,
      errors: [{
        path: [],
        message: err instanceof Error ? err.message : "Failed to read file",
        code: "FILE_READ_ERROR",
        file: path,
      }],
    };
  }
};
