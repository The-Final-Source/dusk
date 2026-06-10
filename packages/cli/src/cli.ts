#!/usr/bin/env node
import { initProject } from "./init.js";
import { validateIntents } from "./validate.js";
import { inspectReport } from "./inspectReport.js";
import { checkHook } from "./checkHook.js";
import { listRoles, renderRoles } from "./roles.js";
import { listSkills, renderSkills } from "./skills.js";
import { runVerify } from "./verify.js";
import type { ConflictChoice } from "./settingsMerge.js";

const HELP = `dusk — Intent Architecture CLI

Usage:
  dusk init                   Scaffold .ia/* + .claude/{agents,skills} and install the PreToolUse gate
  dusk validate               Validate all intents (reports file:line on failure)
  dusk verify <path|scope>    Run the Verifier procedure read-only; print per-triple verdicts
  dusk inspect <intent-path>  Hierarchical satisfaction, claim lists, test children, low-confidence supports
  dusk roles                  List the nine installed role files (memory, model, skill count)
  dusk skills                 Introspect installed role-bound skills, grouped by role
  dusk doctor --check-hook    Verify the gate is installed (exit 0 ok / 2 config / 3 round-trip)
                              add --repair to re-run the install for configuration issues
  dusk --help                 Show this help
`;

const HELP_TEXT: Record<string, string> = {
  verify:
    "dusk verify <path|scope>\n  Run the Verifier procedure read-only over the intents touching a file (or an\n  intent scope) and print per-triple verdicts. Mutates no working tree, makes no\n  commit. Runs the Verifier on the ambient Claude Code model (no API key needed).\n  Flags: --model <id>   override the verifier model\n  Example: dusk verify packages/api/src/services/notifications/index.ts\n",
  inspect:
    "dusk inspect <intent-path>\n  Report an intent's own-triple satisfaction, its test-pyramid children\n  satisfaction, and any low-confidence supports from the most recent verdict.\n  Flags: (none)\n  Example: dusk inspect notifications/send\n",
  roles:
    "dusk roles\n  Enumerate the nine installed .claude/agents/dusk-*.md role files with each\n  role's declared memory scope, model, and skill count.\n  Flags: (none)\n  Example: dusk roles\n",
  skills:
    "dusk skills\n  Enumerate installed role-bound skills grouped by role, matching the layout\n  under .claude/skills/dusk/<role>/.\n  Flags: (none)\n  Example: dusk skills\n",
};

const wantsHelp = (args: string[]): boolean => args.includes("--help") || args.includes("-h");

function promptConflict(existing: string): ConflictChoice {
  process.stderr.write(`Conflict: an existing PreToolUse hook matches Write/Edit:\n  ${existing}\n`);
  process.stderr.write("Dusk appended its gate after it (re-run interactively to choose replace/abort).\n");
  return "append";
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}

async function run(command: string | undefined, rest: string[]): Promise<number> {
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
    case "verify": {
      if (wantsHelp(rest) || rest.length === 0) {
        process.stdout.write(HELP_TEXT.verify);
        return rest.length === 0 && !wantsHelp(rest) ? 1 : 0;
      }
      const result = await runVerify(root, rest[0], { model: flagValue(rest, "--model") });
      process.stdout.write(result.text);
      return result.ok ? 0 : 1;
    }
    case "inspect": {
      if (wantsHelp(rest) || rest.length === 0) {
        process.stdout.write(HELP_TEXT.inspect);
        return rest.length === 0 && !wantsHelp(rest) ? 1 : 0;
      }
      const result = inspectReport(root, rest[0]);
      process.stdout.write(result.text);
      return result.ok ? 0 : 1;
    }
    case "roles": {
      if (wantsHelp(rest)) return process.stdout.write(HELP_TEXT.roles), 0;
      process.stdout.write(renderRoles(listRoles(root)));
      return 0;
    }
    case "skills": {
      if (wantsHelp(rest)) return process.stdout.write(HELP_TEXT.skills), 0;
      process.stdout.write(renderSkills(listSkills(root)));
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
run(command, rest).then((code) => process.exit(code));
