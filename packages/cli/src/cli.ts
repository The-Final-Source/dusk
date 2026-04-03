#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("dusk")
  .description("Dusk — constraint-driven development CLI")
  .version("0.0.1");

// Commands will be added by subsequent beads
// program.addCommand(initCommand);
// program.addCommand(validateCommand);
// program.addCommand(inspectCommand);

program.parse();
