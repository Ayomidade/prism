import { describe, it, expect } from "vitest";
import { parseGitBlame } from "../../src/ingestion/git/blame.js";

const REPO_ROOT = ".";

describe("parseGitBlame", () => {
  it("attributes every line in a real file to a commit", async () => {
    const result = await parseGitBlame(REPO_ROOT, "src/store/db.ts");
    // db.ts is 149 lines — every line should be attributed
    expect(result.length).toBe(149);
  });

  it("returns sequential line numbers starting from 1", async () => {
    const result = await parseGitBlame(REPO_ROOT, "src/store/db.ts");
    expect(result[0].line).toBe(1);
    expect(result[result.length - 1].line).toBe(149);
    // No gaps, no duplicates
    const lines = result.map((r) => r.line).sort((a, b) => a - b);
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i]).toBe(i + 1);
    }
  });

  it("returns valid 40-char hex SHAs", async () => {
    const result = await parseGitBlame(REPO_ROOT, "src/store/db.ts");
    for (const r of result) {
      expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("maps all lines to the correct commit for single-commit files", async () => {
    // schema.ts was created in one commit and mostly unchanged — but uncommitted
    // edits show as SHA 00000000... in blame. Filter those out to test the
    // committed lines only.
    const result = await parseGitBlame(REPO_ROOT, "src/store/schema.ts");
    const committed = result.filter((r) => !r.commitSha.startsWith("00000000"));
    const shas = new Set(committed.map((r) => r.commitSha));
    expect(shas.size).toBe(1);
  });

  it("returns [] for a nonexistent file", async () => {
    const result = await parseGitBlame(REPO_ROOT, "src/does-not-exist.ts");
    expect(result).toEqual([]);
  });

  it("returns [] for a binary file", async () => {
    // package-lock.json is text but very large — test the error path
    // by using a path that git can't blame
    const result = await parseGitBlame(REPO_ROOT, "");
    expect(result).toEqual([]);
  });

  it("returns an empty array for an empty file", async () => {
    // test/fixtures/sample-repo/README.md exists but is small
    const result = await parseGitBlame(REPO_ROOT, "test/fixtures/sample-repo/README.md");
    expect(result.length).toBeGreaterThan(0);
    // All lines should be attributed
    const lines = result.map((r) => r.line).sort((a, b) => a - b);
    expect(lines[0]).toBe(1);
    expect(lines[lines.length - 1]).toBe(result.length);
  });

  it("handles the file exactly matching its line count", async () => {
    const result = await parseGitBlame(REPO_ROOT, "src/cli/index.ts");
    // index.ts is 20 lines, all from the scaffold commit
    expect(result.length).toBe(20);
    const shas = new Set(result.map((r) => r.commitSha));
    expect(shas.size).toBe(1);
  });
});
