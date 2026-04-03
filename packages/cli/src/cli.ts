#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { validateCommand } from "./commands/validate.js";
import { inspectCommand } from "./commands/inspect.js";

const program = new Command();

program
  .name("dusk")
  .description("Dusk — constraint-driven development CLI")
  .version("0.0.1");

program.addCommand(initCommand);
program.addCommand(validateCommand);
program.addCommand(inspectCommand);

program.parse();
