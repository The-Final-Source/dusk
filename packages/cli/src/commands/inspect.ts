import { Command } from "commander";
import { basename } from "node:path";
import chalk from "chalk";
import { readBlockFile, readIntentFile, formatErrors } from "@dusk/parser";

const obligationColor = (obligation: string): string => {
  switch (obligation) {
    case "must": return chalk.red(obligation);
    case "should": return chalk.yellow(obligation);
    case "may": return chalk.green(obligation);
    default: return obligation;
  }
};

const inspectBlock = (block: any): void => {
  console.log(chalk.bold.underline(`Block: ${block.id}`));
  console.log(`  Version: ${block.version}`);
  console.log(`  Layer: ${chalk.cyan(block.layer)}`);
  console.log(`  Summary: ${block.summary}`);
  console.log();

  console.log(chalk.bold("Constraints:"));
  for (const c of block.constraints) {
    const neg = c.negative ? chalk.red("[NOT] ") : "";
    const verif = c.verifiability ? chalk.dim(` [${c.verifiability}]`) : "";
    console.log(`  ${obligationColor(c.obligation)} ${neg}${c.id}${verif}`);
    console.log(`    ${c.text}`);
  }

  if (block.relates_to && block.relates_to.length > 0) {
    console.log();
    console.log(chalk.bold("Relationships:"));
    for (const r of block.relates_to) {
      console.log(`  ${chalk.magenta(r.relationship)} → ${r.target}`);
      console.log(`    ${r.rationale}`);
    }
  }

  if (block.decision_points && block.decision_points.length > 0) {
    console.log();
    console.log(chalk.bold("Decision Points:"));
    for (const dp of block.decision_points) {
      const def = dp.default ? chalk.dim(` (default: ${dp.default})`) : "";
      console.log(`  ${dp.id}: ${dp.description}${def}`);
      console.log(`    Options: ${dp.options.join(", ")}`);
    }
  }
};

const inspectIntent = (intent: any): void => {
  console.log(chalk.bold.underline(`Intent: ${intent.id}`));
  console.log(`  Scope: ${intent.scope}`);
  console.log(`  Adopts: ${intent.adopts.join(", ") || "none"}`);
  console.log();

  if (intent.decisions && intent.decisions.length > 0) {
    console.log(chalk.bold("Decisions:"));
    for (const d of intent.decisions) {
      const rationale = d.rationale ? chalk.dim(` — ${d.rationale}`) : "";
      console.log(`  ${d.point}: ${chalk.cyan(d.choice)}${rationale}`);
    }
    console.log();
  }

  if (intent.constraints && intent.constraints.length > 0) {
    console.log(chalk.bold("Constraints:"));
    for (const c of intent.constraints) {
      const verif = c.verifiability ? chalk.dim(` [${c.verifiability}]`) : chalk.dim(" [unclassified]");
      console.log(`  ${obligationColor(c.obligation)} ${c.id}${verif}`);
      console.log(`    ${c.text}`);
    }
  }

  if (intent.relates_to && intent.relates_to.length > 0) {
    console.log();
    console.log(chalk.bold("Relationships:"));
    for (const r of intent.relates_to) {
      console.log(`  ${chalk.magenta(r.relationship)} → ${r.target}`);
      console.log(`    ${r.rationale}`);
    }
  }
};

export const inspectCommand = new Command("inspect")
  .description("Pretty-print a block or intent file with highlighted relationships")
  .argument("<path>", "Path to block or intent file")
  .action(async (filePath: string) => {
    const name = basename(filePath);

    if (name.endsWith(".block.yaml") || name.endsWith(".block.yml")) {
      const result = await readBlockFile(filePath);
      if (!result.success) {
        console.error(formatErrors(result.errors));
        process.exit(1);
      }
      inspectBlock(result.data);
    } else if (name === "intent.yaml" || name === "intent.yml") {
      const result = await readIntentFile(filePath);
      if (!result.success) {
        console.error(formatErrors(result.errors));
        process.exit(1);
      }
      inspectIntent(result.data);
    } else {
      console.error(`Cannot inspect: ${name}`);
      console.error("Expected: *.block.yaml or intent.yaml");
      process.exit(1);
    }
  });
