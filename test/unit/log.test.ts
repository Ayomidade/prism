import { describe, it, expect } from "vitest";
import { parseGitLog } from "../../src/ingestion/git/log.js";

describe("parseGitLog", () => {
  it("parses real commits from this repo", async () => {
    const commits = await parseGitLog(".");
    expect(commits.length).toBeGreaterThan(0);
  });

  it("does not leak the record separator into commit messages", async () => {
    const commits = await parseGitLog(".");
    for (const c of commits) {
      expect(c.message).not.toContain("\x1e");
    }
  });

  it("returns real SHAs (40 hex chars)", async () => {
    const commits = await parseGitLog(".");
    expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
