import type { HistoryEntry } from "../graph/query.js";

// Default, no-AI "why" summary builder. Assembles raw commit messages and
// PR/issue text into a readable summary tagged confidence: "documented".
// This is the required v1 default -- see docs/mvp-contract.md.
//
// AI-assisted summarization (confidence: "ai-inferred") is an explicit
// fast-follow, not part of the v1 contract. Do not add an AI dependency here.

/**
 * Builds a human-readable summary of why code exists, based on commit history.
 *
 * @param history - Commit entries that touched the target location, most recent first
 * @param target  - Human-readable target description (e.g. "src/foo.ts:42" or "openDatabase")
 * @returns Formatted summary string
 */
export function buildTemplateSummary(
  history: HistoryEntry[],
  target: string
): string {
  if (history.length === 0) {
    return `No history found for ${target}.\nThis code may be new or not yet indexed.`;
  }

  const lines: string[] = [];
  lines.push(`Why does ${target} exist?`);
  lines.push("");

  // Show up to 10 most recent commits
  const shown = history.slice(0, 10);

  for (const entry of shown) {
    const date = entry.date.slice(0, 10); // YYYY-MM-DD
    const sha = entry.commitSha.slice(0, 7);
    // First line of commit message only
    const summary = entry.message.split("\n")[0];
    lines.push(`${date}  ${sha}  ${entry.author}`);
    lines.push(`  ${summary}`);
  }

  if (history.length > 10) {
    lines.push(`  ... and ${history.length - 10} more commits`);
  }

  lines.push("");
  lines.push(`confidence: documented (${history.length} commit${history.length === 1 ? "" : "s"})`);

  return lines.join("\n");
}

/**
 * Builds a JSON-serializable summary for --json output mode.
 *
 * @param history - Commit entries that touched the target location
 * @param target  - Human-readable target description
 * @returns Object suitable for JSON.stringify
 */
export function buildTemplateSummaryJson(
  history: HistoryEntry[],
  target: string
): {
  target: string;
  confidence: string;
  commitCount: number;
  history: HistoryEntry[];
} {
  return {
    target,
    confidence: history.length > 0 ? "documented" : "none",
    commitCount: history.length,
    history,
  };
}
