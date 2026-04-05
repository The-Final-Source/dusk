import { Command } from "commander";
import { mkdir, writeFile, access, constants } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { stringify as stringifyYaml } from "yaml";

const DEFAULT_CONFIG = {
  version: "1.0.0",
  blocks: "./blocks",
  intents_dir: ".ia/intents",
  scope_root: ".",
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const initCommand = new Command("init")
  .description("Initialize a Dusk project with config and directory structure")
  .argument("[directory]", "Target directory", ".")
  .action(async (directory: string) => {
    const targetDir = resolve(directory);

    // Path safety: reject relative paths that traverse above cwd
    if (!isAbsolute(directory) && directory !== ".") {
      const cwd = process.cwd();
      if (!targetDir.startsWith(cwd)) {
        console.error("Error: Target directory must be within or below the current directory");
        process.exit(1);
      }
    }

    const configPath = join(targetDir, "dusk.config.yml");
    const iaDir = join(targetDir, ".ia");
    const intentsDir = join(iaDir, "intents");
    const cacheDir = join(iaDir, "cache");
    const adherenceDir = join(iaDir, "adherence");

    // Create directories
    await mkdir(intentsDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await mkdir(adherenceDir, { recursive: true });

    // Write config (skip if exists)
    if (await fileExists(configPath)) {
      console.log("dusk.config.yml already exists, skipping");
    } else {
      const configYaml = stringifyYaml(DEFAULT_CONFIG);
      await writeFile(configPath, configYaml);
      console.log("Created dusk.config.yml");
    }

    console.log("Initialized .ia/ directory structure");
    console.log("Done! Your Dusk project is ready.");
  });
