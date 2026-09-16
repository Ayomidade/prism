import type { HistoryEntry } from "../graph/query.js";

// Shared prompt construction, used by every AI provider implementation so
// they all send the model an identical prompt — extracted rather than
// duplicated per provider, since duplicated logic drifting out of sync is
// exactly the class of bug found earlier in resolveImport (build-graph.ts
// vs graph-load.ts).

export const MAX_HISTORY_ENTRIES = 15;

export function buildPrompt(history: HistoryEntry[], target: string): string {
  const entries = history.slice(0, MAX_HISTORY_ENTRIES);

  const historyBlock = entries
    .map((e) => {
      const date = e.date.slice(0, 10);
      const sha = e.commitSha.slice(0, 7);
      const msg = e.message.split("\n")[0];
      const prs =
        e.prNumbers.length > 0
          ? ` (PRs: ${e.prNumbers.map((n) => `#${n}`).join(", ")})`
          : "";
      return `${date} ${sha} ${e.author}: ${msg}${prs}`;
    })
    .join("\n");

  return `You are analyzing why a specific piece of code exists in a codebase.

Target: ${target}

Commit history (most recent first):
${historyBlock}

Based on this commit history, provide a concise 2-3 sentence explanation of why this code exists. Focus on the purpose and intent, not just describing what the commits say. If there are PRs linked, mention them. Be specific and actionable.`;
}

export function buildTemplateHeader(
  history: HistoryEntry[],
  target: string,
): string {
  const lines: string[] = [];
  lines.push(`Why does ${target} exist?`);
  lines.push("");

  const shown = history.slice(0, 5);
  for (const entry of shown) {
    const date = entry.date.slice(0, 10);
    const sha = entry.commitSha.slice(0, 7);
    const summary = entry.message.split("\n")[0];
    lines.push(`${date}  ${sha}  ${entry.author}`);
    lines.push(`  ${summary}`);
  }

  if (history.length > 5) {
    lines.push(`  ... and ${history.length - 5} more commits`);
  }

  return lines.join("\n");
}
