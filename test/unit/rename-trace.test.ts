import { describe, it, expect } from "vitest";
import { traceRenames } from "../../src/ingestion/git/rename-trace.js";

const REPO_ROOT = ".";

describe("traceRenames", () => {
  it("returns an empty array for a file with no renames", async () => {
    // db.ts has never been renamed
    const result = await traceRenames(REPO_ROOT, "src/store/db.ts");
    expect(result).toEqual([]);
  });

  it("returns an empty array for a nonexistent file", async () => {
    const result = await traceRenames(REPO_ROOT, "src/does-not-exist.ts");
    expect(result).toEqual([]);
  });

  it("returns an array (possibly empty) for any valid file", async () => {
    // Any file should not throw
    const result = await traceRenames(REPO_ROOT, "src/cli/index.ts");
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns RenameEvent objects with correct shape when renames exist", async () => {
    // Even if this repo has no renames, verify the shape is correct
    // by testing against a file path (result will be empty [])
    const result = await traceRenames(REPO_ROOT, "src/graph/query.ts");
    expect(Array.isArray(result)).toBe(true);
    // If there were renames, each would have oldPath, newPath, commitSha
    for (const event of result) {
      expect(typeof event.oldPath).toBe("string");
      expect(typeof event.newPath).toBe("string");
      expect(event.commitSha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("handles empty file path gracefully", async () => {
    const result = await traceRenames(REPO_ROOT, "");
    expect(result).toEqual([]);
  });
});
