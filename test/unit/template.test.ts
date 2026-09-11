import { describe, it, expect } from "vitest";
import { buildTemplateSummary, buildTemplateSummaryJson } from "../../src/summarize/template.js";
import type { HistoryEntry } from "../../src/graph/query.js";

const SAMPLE_HISTORY: HistoryEntry[] = [
  { commitSha: "abc1234567890", message: "Add schema version check", date: "2026-09-10T09:00:00Z", author: "Alice", prNumbers: [42], prTitles: ["Add schema validation"] },
  { commitSha: "def5678901234", message: "Refactor openDatabase\n\nMoved connection pooling to a separate function", date: "2026-09-05T14:30:00Z", author: "Bob", prNumbers: [], prTitles: [] },
  { commitSha: "ghi9012345678", message: "Initial implementation", date: "2026-09-01T10:00:00Z", author: "Alice", prNumbers: [], prTitles: [] },
];

describe("buildTemplateSummary", () => {
  it("formats a human-readable summary with commit history", () => {
    const result = buildTemplateSummary(SAMPLE_HISTORY, "src/foo.ts:42");

    expect(result).toContain("Why does src/foo.ts:42 exist?");
    expect(result).toContain("2026-09-10  abc1234  Alice");
    expect(result).toContain("Add schema version check");
    expect(result).toContain("2026-09-05  def5678  Bob");
    expect(result).toContain("Refactor openDatabase"); // only first line
    expect(result).toContain("confidence: documented (3 commits)");
  });

  it("truncates commit messages to the first line", () => {
    const result = buildTemplateSummary(SAMPLE_HISTORY, "test");
    // The second commit has a multi-line message
    expect(result).toContain("Refactor openDatabase");
    expect(result).not.toContain("Moved connection pooling");
  });

  it("shows 'no history found' for empty history", () => {
    const result = buildTemplateSummary([], "src/new.ts:1");

    expect(result).toContain("No history found for src/new.ts:1");
    expect(result).not.toContain("confidence:");
  });

  it("shows a truncation notice when more than 10 commits", () => {
    const manyCommits: HistoryEntry[] = Array.from({ length: 15 }, (_, i) => ({
      commitSha: `${i.toString().padStart(7, "0")}1234567`,
      message: `Commit ${i}`,
      date: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      author: "Test",
      prNumbers: [],
      prTitles: [],
    }));

    const result = buildTemplateSummary(manyCommits, "test");
    expect(result).toContain("... and 5 more commits");
  });

  it("uses function name as target", () => {
    const result = buildTemplateSummary(SAMPLE_HISTORY, "openDatabase");
    expect(result).toContain("Why does openDatabase exist?");
  });

  it("shows PR numbers and titles when available", () => {
    const result = buildTemplateSummary(SAMPLE_HISTORY, "test");
    expect(result).toContain("PR #42: Add schema validation");
  });

  it("shows PR number without title when title is missing", () => {
    const historyWithPrNoTitle: HistoryEntry[] = [
      { commitSha: "abc1234567890", message: "Fix bug", date: "2026-09-10T09:00:00Z", author: "Alice", prNumbers: [99], prTitles: [] },
    ];
    const result = buildTemplateSummary(historyWithPrNoTitle, "test");
    expect(result).toContain("PR #99");
    expect(result).not.toContain("PR #99:");
  });
});

describe("buildTemplateSummaryJson", () => {
  it("returns a structured object for JSON output", () => {
    const result = buildTemplateSummaryJson(SAMPLE_HISTORY, "src/foo.ts:42");

    expect(result.target).toBe("src/foo.ts:42");
    expect(result.confidence).toBe("documented");
    expect(result.commitCount).toBe(3);
    expect(result.history).toBe(SAMPLE_HISTORY);
  });

  it("returns confidence 'none' for empty history", () => {
    const result = buildTemplateSummaryJson([], "test");
    expect(result.confidence).toBe("none");
    expect(result.commitCount).toBe(0);
    expect(result.history).toEqual([]);
  });
});
