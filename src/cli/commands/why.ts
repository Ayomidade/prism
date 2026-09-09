import type { Command } from "commander";

// Build spec: docs/prism-v1-build-spec.md Section 5 (`prism why`)
//
// Responsibilities:
// - Resolve the target symbol/line range (file:line or --function name)
// - Look up overlapping commits, most recent first (src/graph/query.ts)
// - Include PR/issue context if available
// - Build a template-based summary tagged confidence: documented (src/summarize/template.ts)
// - Fail clearly with "no significant history" rather than fabricating an answer

export function registerWhyCommand(program: Command): void {
  program
    .command("why")
    .description("Explain why a piece of code exists")
    .argument("[location]", "file:line, e.g. src/foo.ts:42")
    .option("--function <name>", "Look up by function name instead of file:line")
    .option("--json", "Output as JSON instead of formatted text")
    .action(async (_location: string | undefined, _options: { function?: string; json?: boolean }) => {
      // TODO: implement per docs/prism-v1-build-spec.md Section 5
      throw new Error("prism why: not implemented yet");
    });
}
