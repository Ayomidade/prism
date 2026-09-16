import type { EnrichedDependent } from "./impact-types.js";

// Prompt construction for the impact summarizer. Asks the AI to analyze
// how a symbol is being used and what would break if it changes.

const MAX_SOURCE_LINES = 30;

export function buildImpactPrompt(target: string, dependents: EnrichedDependent[]): string {
  const direct = dependents.filter((d) => d.depth === 1);
  const transitive = dependents.filter((d) => d.depth > 1);

  const directBlock = direct
    .map((d) => {
      const header = `── ${d.file}:${d.symbol} (${d.kind}, ${d.edgeType})`;
      const historyLine = d.history.length > 0
        ? `   Recent: ${d.history[0].message.split("\n")[0]}`
        : "";
      const snippet = d.sourceSnippet
        ? `   Source:\n\`\`\`\n${truncateSnippet(d.sourceSnippet, MAX_SOURCE_LINES)}\n\`\`\``
        : "";
      return [header, historyLine, snippet].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const transitiveBlock = transitive
    .map((d) => `  ${d.file}:${d.symbol} (depth ${d.depth}, ${d.edgeType})`)
    .join("\n");

  return `You are analyzing the blast radius of changing a specific symbol in a codebase.

Target: ${target}

Direct dependents (depth 1):
${directBlock || "  (none)"}

${transitive.length > 0 ? `Transitive dependents (depth 2+):\n${transitiveBlock}` : ""}

Based on this dependency graph and the source code of direct dependents:
1. How is this symbol being used? Describe the usage patterns across the codebase.
2. Which dependents are most at risk if this symbol's signature or behavior changes?
3. What kind of breakage would each type of change cause (signature change, return type change, behavior change)?
4. What should be tested after modifying this symbol?

Provide a concise 3-5 sentence analysis. Focus on concrete, actionable information.`;
}

function truncateSnippet(snippet: string, maxLines: number): string {
  const lines = snippet.split("\n");
  if (lines.length <= maxLines) return snippet;
  return lines.slice(0, maxLines).join("\n") + "\n... (truncated)";
}
