import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseGitBlame } from "../../src/ingestion/git/blame.js";
import { parseGitLog } from "../../src/ingestion/git/log.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixtureDir: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "tracecode-blame-test-"));
  execSync("git init -q", { cwd: fixtureDir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: fixtureDir });
  execSync("git config user.name 'Test'", { cwd: fixtureDir });

  // Create a multi-line file committed in a single commit
  mkdirSync(join(fixtureDir, "src"), { recursive: true });
  writeFileSync(
    join(fixtureDir, "src/app.ts"),
    [
      "export function greet(name: string): string {",
      "  return `Hello, ${name}!`;",
      "}",
      "",
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ].join("\n"),
  );
  execSync("git add -A && git commit -m 'feat: add utils'", {
    cwd: fixtureDir,
  });

  // Second commit modifying one function
  writeFileSync(
    join(fixtureDir, "src/app.ts"),
    [
      "export function greet(name: string): string {",
      "  return `Hi, ${name}!`;",
      "}",
      "",
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ].join("\n"),
  );
  execSync("git add -A && git commit -m 'fix: update greeting'", {
    cwd: fixtureDir,
  });
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe("parseGitBlame", () => {
  it("attributes every line in a real file to a commit", async () => {
    const result = await parseGitBlame(fixtureDir, "src/app.ts");
    expect(result.length).toBe(7);
  });

  it("returns sequential line numbers starting from 1", async () => {
    const result = await parseGitBlame(fixtureDir, "src/app.ts");
    expect(result[0].line).toBe(1);
    expect(result[result.length - 1].line).toBe(7);
    const lines = result.map((r) => r.line).sort((a, b) => a - b);
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i]).toBe(i + 1);
    }
  });

  it("returns valid 40-char hex SHAs", async () => {
    const result = await parseGitBlame(fixtureDir, "src/app.ts");
    for (const r of result) {
      expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("attributes modified lines to the newer commit", async () => {
    const result = await parseGitBlame(fixtureDir, "src/app.ts");
    // Line 2 (greet body) was changed in commit 2; all others from commit 1
    const line2 = result.find((r) => r.line === 2)!;
    const line3 = result.find((r) => r.line === 3)!;
    expect(line2.commitSha).not.toBe(line3.commitSha);
  });

  it("returns [] for a nonexistent file", async () => {
    const result = await parseGitBlame(fixtureDir, "src/does-not-exist.ts");
    expect(result).toEqual([]);
  });

  it("returns [] for an empty path", async () => {
    const result = await parseGitBlame(fixtureDir, "");
    expect(result).toEqual([]);
  });
});

describe("parseGitLog", () => {
  it("parses the fixture commits", async () => {
    const commits = await parseGitLog(fixtureDir);
    expect(commits.length).toBe(2);
  });

  it("does not leak the record separator into commit messages", async () => {
    const commits = await parseGitLog(fixtureDir);
    for (const c of commits) {
      expect(c.message).not.toContain("\x1e");
    }
  });

  it("returns real SHAs (40 hex chars)", async () => {
    const commits = await parseGitLog(fixtureDir);
    expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("parses commits in reverse chronological order", async () => {
    const commits = await parseGitLog(fixtureDir);
    expect(commits[0].message).toContain("fix: update greeting");
    expect(commits[1].message).toContain("feat: add utils");
  });
});
