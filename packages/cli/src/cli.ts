#!/usr/bin/env node
import { initProject } from "./init.js";
import { validateIntents } from "./validate.js";
import { inspectIntent } from "./inspect.js";
import { checkHook } from "./checkHook.js";
import type { ConflictChoice } from "./settingsMerge.js";

const HELP = `dusk — Intent Architecture CLI

Usage:
  dusk init                   Scaffold .ia/* + .claude/agents and install the PreToolUse gate
  dusk validate               Validate all intents (reports file:line on failure)
  dusk inspect <intent-path>  Show an intent: triples, obligation, relations, descendants, gaps
  dusk doctor --check-hook    Verify the gate is installed (exit 0 ok / 2 config / 3 round-trip)
                              add --repair to re-run the install for configuration issues
  dusk --help                 Show this help
`;

const wantsHelp = (args: string[]): boolean => args.includes("--help") || args.includes("-h");

function promptConflict(existing: string): ConflictChoice {
  process.stderr.write(`Conflict: an existing PreToolUse hook matches Write/Edit:\n  ${existing}\n`);
  process.stderr.write("Dusk appended its gate after it (re-run interactively to choose replace/abort).\n");
  return "append";
}

function run(command: string | undefined, rest: string[]): number {
  const root = process.cwd();
  if (!command || command === "help" || wantsHelp([command])) {
    process.stdout.write(HELP);
    return 0;
  }
  switch (command) {
    case "init": {
      if (wantsHelp(rest)) return process.stdout.write("dusk init — scaffold + install the PreToolUse gate\n"), 0;
      const result = initProject(root, { conflictResolver: promptConflict });
      process.stdout.write(`init: ${result.action} (${result.settingsPath})\n`);
      return 0;
    }
    case "validate": {
      if (wantsHelp(rest)) return process.stdout.write("dusk validate — validate all intents under .ia/intents\n"), 0;
      const result = validateIntents(root);
      if (result.ok) {
        process.stdout.write(`validate: ${result.count} intents OK\n`);
        return 0;
      }
      for (const failure of result.failures) process.stderr.write(`${failure.file}:${failure.line}  ${failure.message}\n`);
      return 1;
    }
    case "inspect": {
      if (wantsHelp(rest) || rest.length === 0) {
        process.stdout.write("dusk inspect <intent-path>\n");
        return rest.length === 0 ? 1 : 0;
      }
      const result = inspectIntent(root, rest[0]);
      if (!result) {
        process.stderr.write(`inspect: intent not found: ${rest[0]}\n`);
        return 1;
      }
      process.stdout.write(
        `${JSON.stringify(
          {
            id: result.intent.id,
            obligation: result.intent.obligation,
            compose: result.intent.compose,
            triples: (result.intent.triples ?? []).map((t) => t.id),
            relates_to: result.intent.relates_to,
            descendants: result.descendants,
            testChildren: result.testChildren,
            unsatisfiedTestChildren: result.unsatisfiedTestChildren,
            aspectsUnclaimed: result.aspectsUnclaimed,
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }
    case "doctor": {
      if (wantsHelp(rest)) return process.stdout.write("dusk doctor --check-hook [--repair]\n"), 0;
      if (rest.includes("--check-hook")) {
        const result = checkHook(root, { repair: rest.includes("--repair") });
        process.stdout.write(`doctor --check-hook: ${result.message}\n`);
        return result.exitCode;
      }
      process.stdout.write("doctor: pass --check-hook (full project checks land in later phases)\n");
      return 0;
    }
    default:
      process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

const [command, ...rest] = process.argv.slice(2);
process.exit(run(command, rest));
