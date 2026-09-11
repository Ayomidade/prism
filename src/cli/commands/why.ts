import type { Command } from "commander";
import { openDatabase } from "../../store/db.js";
import { queryHistoryForLocation, queryHistoryForFunction } from "../../graph/query.js";
import { buildTemplateSummary, buildTemplateSummaryJson } from "../../summarize/template.js";
import { createAiSummarizer } from "../../summarize/ai.js";
import { getAnthropicKey } from "../../config/tokens.js";
import type { Summarizer } from "../../summarize/types.js";
import { existsSync } from "node:fs";

// Build spec: docs/prism-v1-build-spec.md Section 5 (`prism why`)
//
// Responsibilities:
// - Resolve the target symbol/line range (file:line or --function name)
// - Look up overlapping commits, most recent first (src/graph/query.ts)
// - Include PR/issue context if available
// - Build a template-based summary tagged confidence: documented (src/summarize/template.ts)
// - Fail clearly with "no significant history" rather than fabricating an answer

/**
 * Parses a "file:line" location string into { filePath, line }.
 * Returns null if the format is invalid.
 */
function parseLocation(location: string): { filePath: string; line: number } | null {
  const match = location.match(/^(.+):(\d+)$/);
  if (!match) return null;
  return { filePath: match[1], line: parseInt(match[2], 10) };
}

export function registerWhyCommand(program: Command): void {
  program
    .command("why")
    .description("Explain why a piece of code exists")
    .argument("[location]", "file:line, e.g. src/foo.ts:42")
    .option("--function <name>", "Look up by function name instead of file:line")
    .option("--json", "Output as JSON instead of formatted text")
    .action(async (location: string | undefined, options: { function?: string; json?: boolean }) => {
      const dbPath = ".prism/graph.db";
      if (!existsSync(dbPath)) {
        console.error("Error: No indexed data found. Run `prism init` first.");
        process.exit(1);
      }

      const db = openDatabase(dbPath);

      // Use AI summarizer if Anthropic key is configured, fall back to template
      const anthropicKey = getAnthropicKey();
      const summarizer: Summarizer = anthropicKey
        ? await createAiSummarizer(anthropicKey)
        : { summarize: async (h, t) => ({ text: buildTemplateSummary(h, t), confidence: "documented" as const }), summarizeJson: async (h, t) => buildTemplateSummaryJson(h, t) };

      try {
        let history;
        let target;

        if (options.function) {
          // Function name lookup
          target = options.function;
          history = queryHistoryForFunction(db, options.function);
        } else if (location) {
          // file:line lookup
          const parsed = parseLocation(location);
          if (!parsed) {
            console.error(
              `Error: Invalid location format "${location}". Expected file:line, e.g. src/foo.ts:42`
            );
            process.exit(1);
          }
          target = location;
          history = queryHistoryForLocation(db, parsed.filePath, parsed.line);
        } else {
          console.error("Error: Provide a location (file:line) or use --function <name>.");
          program.help();
        }

        if (options.json) {
          const json = await summarizer.summarizeJson(history, target);
          console.log(JSON.stringify(json, null, 2));
        } else {
          const result = await summarizer.summarize(history, target);
          console.log(result.text);
        }
      } finally {
        db.close();
      }
    });
}
