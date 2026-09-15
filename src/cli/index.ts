#!/usr/bin/env node
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerWhyCommand } from "./commands/why.js";
import { registerImpactCommand } from "./commands/impact.js";
import { registerConfigCommand } from "./commands/config.js";

// See docs/prism-v1-build-spec.md Section 5 for the exact command contract.

const program = new Command();

program
  .name("prism")
  .description("Understand your codebase before you change it.")
  .version("0.1.0");

registerInitCommand(program);
registerWhyCommand(program);
registerImpactCommand(program);
registerConfigCommand(program);

program.parseAsync(process.argv);
