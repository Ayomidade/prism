import { describe, it, expect } from "vitest";
import { parseGitLog } from "../../src/ingestion/git/log.js";

// Lightweight live test — verifies parseGitLog works against the real repo
// without asserting commit counts or content (those are in blame.test.ts
// using an isolated fixture repo).
describe("parseGitLog (live)", () => {
  it("returns at least one commit from the real repo", async () => {
    const commits = await parseGitLog(".");
    expect(commits.length).toBeGreaterThan(0);
  });

  it("does not leak the record separator", async () => {
    const commits = await parseGitLog(".");
    for (const c of commits) {
      expect(c.message).not.toContain("\x1e");
    }
  });
});
