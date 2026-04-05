import { join } from "node:path";
import { access, constants } from "node:fs/promises";

import { readIntentFile } from "./intentFile.js";
import { readSourceMapFile } from "./sourceMapFile.js";
import { readAuditFile } from "./auditFile.js";
import type { ParseResult } from "./errors.js";

// Use the return types from the parser functions
type IntentData = Extract<
  Awaited<ReturnType<typeof readIntentFile>>,
  { success: true }
>["data"];
type SourceMapData = Extract<
  Awaited<ReturnType<typeof readSourceMapFile>>,
  { success: true }
>["data"];
type AuditData = Extract<
  Awaited<ReturnType<typeof readAuditFile>>,
  { success: true }
>["data"];

export type IntentUnit = {
  intent: IntentData;
  sourceMap: SourceMapData | null;
  audit: AuditData | null;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

export const loadIntentDirectory = async (
  dirPath: string,
): Promise<ParseResult<IntentUnit>> => {
  const intentPath = join(dirPath, "intent.yaml");
  const sourceMapPath = join(dirPath, "source-map.json");
  const auditPath = join(dirPath, "audit.json");

  // intent.yaml is required
  const intentResult = await readIntentFile(intentPath);
  if (!intentResult.success) {
    return intentResult;
  }

  // source-map.json is optional
  let sourceMap: SourceMapData | null = null;
  if (await fileExists(sourceMapPath)) {
    const smResult = await readSourceMapFile(sourceMapPath);
    if (!smResult.success) {
      return smResult;
    }
    sourceMap = smResult.data;
  }

  // audit.json is optional
  let audit: AuditData | null = null;
  if (await fileExists(auditPath)) {
    const auditResult = await readAuditFile(auditPath);
    if (!auditResult.success) {
      return auditResult;
    }
    audit = auditResult.data;
  }

  return {
    success: true,
    data: { intent: intentResult.data, sourceMap, audit },
  };
};
