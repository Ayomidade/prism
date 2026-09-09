import type { Command } from "commander";

// Build spec: docs/prism-v1-build-spec.md Section 5 (`prism impact`)
//
// Responsibilities:
// - Resolve the symbol (disambiguate by file path if the name is ambiguous)
// - Traverse the reverse dependency graph (src/graph/query.ts)
// - Output a tree: direct dependents first, then transitive, grouped by file
// - --json returns a flat list with a `depth` field per dependent

export function registerImpactCommand(program: Command): void {
  program
    .command("impact")
    .description("Show what could break if a symbol changes")
    .argument("<symbol>", "Symbol name, or file:symbol to disambiguate")
    .option("--json", "Output as JSON instead of a tree")
    .action(async (_symbol: string, _options: { json?: boolean }) => {
      // TODO: implement per docs/prism-v1-build-spec.md Section 5
      throw new Error("prism impact: not implemented yet");
    });
}
