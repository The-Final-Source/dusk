import { Command } from "commander";
import { basename } from "node:path";

import {
  readBlockFile,
  readIntentFile,
  readSourceMapFile,
  readAuditFile,
  readConfigFile,
  formatErrors,
} from "@dusk/parser";

type FileType = "block" | "intent" | "source-map" | "audit" | "config";

const detectFileType = (filePath: string): FileType | null => {
  const name = basename(filePath);
  if (name.endsWith(".block.yaml") || name.endsWith(".block.yml"))
    return "block";
  if (name === "intent.yaml" || name === "intent.yml") return "intent";
  if (name === "source-map.json") return "source-map";
  if (name === "audit.json") return "audit";
  if (name === "dusk.config.yml" || name === "dusk.config.yaml")
    return "config";
  return null;
};

export const validateCommand = new Command("validate")
  .description("Validate a block, intent, or config file against its schema")
  .argument("<path>", "Path to file to validate")
  .action(async (filePath: string) => {
    const fileType = detectFileType(filePath);

    if (!fileType) {
      console.error(`Unknown file type: ${basename(filePath)}`);
      console.error(
        "Expected: *.block.yaml, intent.yaml, source-map.json, audit.json, or dusk.config.yml",
      );
      process.exit(1);
    }

    let result;
    switch (fileType) {
      case "block":
        result = await readBlockFile(filePath);
        break;
      case "intent":
        result = await readIntentFile(filePath);
        break;
      case "source-map":
        result = await readSourceMapFile(filePath);
        break;
      case "audit":
        result = await readAuditFile(filePath);
        break;
      case "config":
        result = await readConfigFile(filePath);
        break;
    }

    if (result.success) {
      console.log(`\u2713 Valid ${fileType}: ${filePath}`);
    } else {
      console.error(`\u2717 Invalid ${fileType}: ${filePath}`);
      console.error(formatErrors(result.errors));
      process.exit(1);
    }
  });
