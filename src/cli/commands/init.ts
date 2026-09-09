import type { Command } from "commander";

// Build spec: docs/prism-v1-build-spec.md Section 5 (`prism init`) + Section 7 (indexing pipeline)
//
// Responsibilities:
// - Detect git repo root (fail clearly if not inside one)
// - Parse full git log/blame history (src/ingestion/git)
// - Parse source files via AST into the graph (src/graph)
// - If a GitHub token is configured, fetch linked PR/issue data (src/ingestion/github)
// - Write everything to .prism/graph.db (src/store)
// - Support --refresh to force a full re-index

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Index the current repository (git history + code structure)")
    .option("--refresh", "Force a full re-index instead of using the existing cache")
    .action(async (_options: { refresh?: boolean }) => {
      // TODO: implement per docs/prism-v1-build-spec.md Section 7
      throw new Error("prism init: not implemented yet");
    });
}
