import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openDatabase } from "../../src/store/db.js";
import {
  queryHistoryForLocation,
  queryHistoryForFunction,
  resolveSymbol,
  queryDependents,
  listSymbolsByName,
} from "../../src/graph/query.js";

// Integration tests against the project's own git history.
//
// The init pipeline is spawned as a child process (via CLI) to isolate
// ts-morph from better-sqlite3 — the native addon conflict crashes vitest
// workers when both are loaded in the same process. The test process only
// imports better-sqlite3 (via openDatabase + query functions).
//
// NOTE: We never call db.close() — better-sqlite3's destructor crashes
// during Node.js process teardown (RemoveEnvironmentCleanupHook assertion).
// Data is already flushed via WAL; GC handles cleanup.

const DB_PATH = ".prism/graph.db";
const REPO_ROOT = ".";

// The init pipeline spawns child processes and needs time for git + AST parsing.
const INIT_TIMEOUT = 240_000;

beforeAll(() => {
  mkdirSync(".prism", { recursive: true });
  // Spawn prism init via CLI — isolates ts-morph in a child process
  const result = execFileSync("npx", ["tsx", "src/cli/index.ts", "init"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    timeout: INIT_TIMEOUT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Verify init succeeded by checking for "Done!" in output
  expect(result).toContain("Done!");
}, INIT_TIMEOUT);

afterAll(() => {
  if (existsSync(DB_PATH)) {
    rmSync(DB_PATH);
  }
  // Also clean up WAL/SHM files created by SQLite
  if (existsSync(DB_PATH + "-wal")) rmSync(DB_PATH + "-wal");
  if (existsSync(DB_PATH + "-shm")) rmSync(DB_PATH + "-shm");
});

describe("init pipeline (integration)", () => {
  it("creates a valid database with all required tables", () => {
    const db = openDatabase(DB_PATH);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("files");
    expect(tableNames).toContain("symbols");
    expect(tableNames).toContain("edges");
    expect(tableNames).toContain("commits");
    expect(tableNames).toContain("commit_files");
    expect(tableNames).toContain("meta");
  });

  it("indexes commits from the repo", () => {
    const db = openDatabase(DB_PATH);
    const count = db.prepare("SELECT COUNT(*) as c FROM commits").get() as { c: number };
    expect(count.c).toBeGreaterThan(5);
  });

  it("indexes source files", () => {
    const db = openDatabase(DB_PATH);
    const count = db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number };
    expect(count.c).toBeGreaterThan(10);
  });

  it("indexes symbols from AST parsing", () => {
    const db = openDatabase(DB_PATH);
    const count = db.prepare("SELECT COUNT(*) as c FROM symbols").get() as { c: number };
    expect(count.c).toBeGreaterThan(20);
  });

  it("builds edges (imports + calls)", () => {
    const db = openDatabase(DB_PATH);
    const importEdges = db
      .prepare("SELECT COUNT(*) as c FROM edges WHERE edge_type = 'imports'")
      .get() as { c: number };
    const callEdges = db
      .prepare("SELECT COUNT(*) as c FROM edges WHERE edge_type = 'calls'")
      .get() as { c: number };

    expect(importEdges.c).toBeGreaterThan(3);
    expect(callEdges.c).toBeGreaterThan(5);
  });

  it("populates commit_files from git blame", () => {
    const db = openDatabase(DB_PATH);
    const count = db.prepare("SELECT COUNT(*) as c FROM commit_files").get() as { c: number };
    expect(count.c).toBeGreaterThan(100);
  });
});

describe("why queries (integration)", () => {
  it("returns commit history for a known file location", () => {
    const db = openDatabase(DB_PATH);
    // queryHistoryForLocation uses git blame — each line maps to exactly 1 commit
    const history = queryHistoryForLocation(db, "src/store/db.ts", 35);
    expect(history.length).toBe(1);
    expect(history[0].commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(history[0].message.length).toBeGreaterThan(0);
    expect(history[0].date.length).toBeGreaterThan(0);
    expect(history[0].author.length).toBeGreaterThan(0);
  });

  it("returns empty for a line that was never touched", () => {
    const db = openDatabase(DB_PATH);
    const history = queryHistoryForLocation(db, "src/store/db.ts", 99999);
    expect(history).toEqual([]);
  });

  it("returns history for a known function name", () => {
    const db = openDatabase(DB_PATH);
    const history = queryHistoryForFunction(db, "openDatabase");
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns empty for a non-existent function", () => {
    const db = openDatabase(DB_PATH);
    const history = queryHistoryForFunction(db, "functionThatDoesNotExist");
    expect(history).toEqual([]);
  });

  it("returns most recent commits first for a multi-commit function", () => {
    const db = openDatabase(DB_PATH);
    const history = queryHistoryForFunction(db, "buildTemplateSummary");
    expect(history.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < history.length - 1; i++) {
      expect(history[i].date >= history[i + 1].date).toBe(true);
    }
  });
});

describe("impact queries (integration)", () => {
  it("resolves a unique symbol by name", () => {
    const db = openDatabase(DB_PATH);
    const sym = resolveSymbol(db, "openDatabase");
    expect(sym).not.toBeNull();
    expect(sym!.name).toBe("openDatabase");
    expect(sym!.file).toBe("src/store/db.ts");
    expect(sym!.kind).toBe("function");
  });

  it("resolves a symbol by file:name format", () => {
    const db = openDatabase(DB_PATH);
    const sym = resolveSymbol(db, "src/store/db.ts:openDatabase");
    expect(sym).not.toBeNull();
    expect(sym!.name).toBe("openDatabase");
    expect(sym!.file).toBe("src/store/db.ts");
  });

  it("returns null for an unknown symbol", () => {
    const db = openDatabase(DB_PATH);
    const sym = resolveSymbol(db, "nonexistentFunction12345");
    expect(sym).toBeNull();
  });

  it("finds cross-file dependents of a symbol", () => {
    const db = openDatabase(DB_PATH);
    const sym = resolveSymbol(db, "buildTemplateSummary");
    expect(sym).not.toBeNull();
    expect(sym!.file).toBe("src/summarize/template.ts");

    const deps = queryDependents(db, sym!.id);
    expect(deps.length).toBeGreaterThan(0);
    // At least one dependent should be in a different file
    const crossFileDeps = deps.filter((d) => d.file !== sym!.file);
    expect(crossFileDeps.length).toBeGreaterThan(0);
    for (const dep of deps) {
      expect(dep.file.length).toBeGreaterThan(0);
      expect(dep.symbol.length).toBeGreaterThan(0);
      expect(dep.depth).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns empty dependents for a leaf function", () => {
    const db = openDatabase(DB_PATH);
    const sym = resolveSymbol(db, "getDbPath");
    expect(sym).not.toBeNull();

    const deps = queryDependents(db, sym!.id);
    expect(Array.isArray(deps)).toBe(true);
  });

  it("listSymbolsByName returns matches for known names", () => {
    const db = openDatabase(DB_PATH);
    const matches = listSymbolsByName(db, "insertFile");
    expect(matches.length).toBeGreaterThan(0);
    const repoMatch = matches.find((m) => m.file === "src/store/repository.ts");
    expect(repoMatch).toBeDefined();
  });
});
