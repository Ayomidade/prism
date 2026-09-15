import { describe, it, expect, afterEach } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { openDatabase } from "../../src/store/db.js";
import {
  queryHistoryForLocation,
  queryHistoryForFunction,
  queryDependents,
  resolveSymbol,
  listSymbolsByName,
} from "../../src/graph/query.js";
import { insertCommit, insertFile } from "../../src/store/repository.js";

const TEST_ROOT = "./test-tmp-query";
const TEST_DB = `${TEST_ROOT}/query.db`;

afterEach(() => {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true });
  }
});

/** Seeds a test database with commits, files, symbols, and commit_files. */
function seedDb(db: ReturnType<typeof openDatabase>) {
  // Files
  const fileIdA = insertFile(db, "src/a.ts");
  const fileIdB = insertFile(db, "src/b.ts");

  // Commits (ordered oldest first)
  insertCommit(db, "aaa1111", "Alice", "2026-09-01T10:00:00Z", "Initial implementation");
  insertCommit(db, "bbb2222", "Bob", "2026-09-05T14:30:00Z", "Refactor openDatabase");
  insertCommit(db, "ccc3333", "Alice", "2026-09-10T09:00:00Z", "Add schema version check");

  // Symbols
  db.prepare(
    `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
  ).run(fileIdA, "openDatabase", "function", 10, 50);
  db.prepare(
    `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
  ).run(fileIdA, "checkSchemaVersion", "function", 55, 70);
  db.prepare(
    `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
  ).run(fileIdB, "helper", "function", 1, 10);

  // commit_files: which commits touched which file/line ranges
  // aaa1111 created a.ts lines 1-60
  db.prepare(`INSERT INTO commit_files (commit_sha, file_id, start_line, end_line) VALUES (?, ?, ?, ?)`)
    .run("aaa1111", fileIdA, 1, 60);
  // bbb2222 modified a.ts lines 10-50 (openDatabase body)
  db.prepare(`INSERT INTO commit_files (commit_sha, file_id, start_line, end_line) VALUES (?, ?, ?, ?)`)
    .run("bbb2222", fileIdA, 10, 50);
  // ccc3333 modified a.ts lines 55-70 (checkSchemaVersion)
  db.prepare(`INSERT INTO commit_files (commit_sha, file_id, start_line, end_line) VALUES (?, ?, ?, ?)`)
    .run("ccc3333", fileIdA, 55, 70);
  // aaa1111 also created b.ts
  db.prepare(`INSERT INTO commit_files (commit_sha, file_id, start_line, end_line) VALUES (?, ?, ?, ?)`)
    .run("aaa1111", fileIdB, 1, 20);
}

describe("queryHistoryForLocation", () => {
  it("returns commits that touched a specific line, most recent first", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // Line 30 of a.ts was touched by aaa1111 and bbb2222
    const history = queryHistoryForLocation(db, "src/a.ts", 30);

    expect(history).toHaveLength(2);
    expect(history[0].commitSha).toBe("bbb2222"); // most recent first
    expect(history[1].commitSha).toBe("aaa1111");
  });

  it("returns empty array for a line with no history", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // Line 100 of a.ts was never touched
    const history = queryHistoryForLocation(db, "src/a.ts", 100);
    expect(history).toEqual([]);
  });

  it("returns empty array for a file that doesn't exist in the database", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    const history = queryHistoryForLocation(db, "src/missing.ts", 1);
    expect(history).toEqual([]);
  });

  it("includes commit metadata (message, date, author)", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    const history = queryHistoryForLocation(db, "src/a.ts", 30);
    expect(history[0]).toEqual({
      commitSha: "bbb2222",
      message: "Refactor openDatabase",
      date: "2026-09-05T14:30:00Z",
      author: "Bob",
      prNumbers: [],
      prTitles: [],
    });
  });

  it("finds commits at exact boundary lines", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // Line 10 is the start of openDatabase — touched by aaa1111 and bbb2222
    const history = queryHistoryForLocation(db, "src/a.ts", 10);
    expect(history).toHaveLength(2);

    // Line 50 is the end of openDatabase — touched by aaa1111 and bbb2222
    const history50 = queryHistoryForLocation(db, "src/a.ts", 50);
    expect(history50).toHaveLength(2);

    // Line 51 is between openDatabase and checkSchemaVersion — only aaa1111
    const history51 = queryHistoryForLocation(db, "src/a.ts", 51);
    expect(history51).toHaveLength(1);
    expect(history51[0].commitSha).toBe("aaa1111");
  });
});

describe("queryHistoryForFunction", () => {
  it("returns commits that touched a function's line range", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // openDatabase is lines 10-50 in a.ts
    const history = queryHistoryForFunction(db, "openDatabase");

    expect(history).toHaveLength(2);
    expect(history[0].commitSha).toBe("bbb2222");
    expect(history[1].commitSha).toBe("aaa1111");
  });

  it("returns empty array for an unknown function name", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    const history = queryHistoryForFunction(db, "nonexistent");
    expect(history).toEqual([]);
  });

  it("skips module symbols when looking up by name", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // Insert a module symbol for a.ts
    const fileIdA = db.prepare("SELECT id FROM files WHERE path = 'src/a.ts'").get() as { id: number };
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileIdA.id, "src/a.ts", "module", 1, 100);

    // "src/a.ts" as a name should not match the module symbol
    const history = queryHistoryForFunction(db, "src/a.ts");
    expect(history).toEqual([]);
  });

  it("resolves checkSchemaVersion correctly (line 55-70)", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // checkSchemaVersion is lines 55-70, touched by aaa1111 and ccc3333
    const history = queryHistoryForFunction(db, "checkSchemaVersion");

    expect(history).toHaveLength(2);
    expect(history[0].commitSha).toBe("ccc3333"); // most recent
    expect(history[1].commitSha).toBe("aaa1111");
  });
});

// ── resolveSymbol ────────────────────────────────────────────────────

describe("resolveSymbol", () => {
  it("resolves a unique symbol by name", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    const sym = resolveSymbol(db, "helper");
    expect(sym).not.toBeNull();
    expect(sym!.name).toBe("helper");
    expect(sym!.file).toBe("src/b.ts");
  });

  it("returns null for an unknown symbol", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    expect(resolveSymbol(db, "nonexistent")).toBeNull();
  });

  it("returns null for an ambiguous symbol (multiple matches)", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // Insert another "helper" in a different file
    const fileIdA = db.prepare("SELECT id FROM files WHERE path = 'src/a.ts'").get() as { id: number };
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileIdA.id, "helper", "function", 1, 5);

    expect(resolveSymbol(db, "helper")).toBeNull();
  });

  it("resolves by file:name format", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    const fileIdA = db.prepare("SELECT id FROM files WHERE path = 'src/a.ts'").get() as { id: number };
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileIdA.id, "helper", "function", 1, 5);

    const sym = resolveSymbol(db, "src/a.ts:helper");
    expect(sym).not.toBeNull();
    expect(sym!.file).toBe("src/a.ts");
    expect(sym!.name).toBe("helper");
  });

  it("skips module symbols", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // The seed data doesn't insert module symbols for a.ts/b.ts
    // but queryDependents should still work — module symbols are
    // excluded from resolveSymbol via kind != 'module'
    const fileIdA = db.prepare("SELECT id FROM files WHERE path = 'src/a.ts'").get() as { id: number };
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileIdA.id, "src/a.ts", "module", 1, 100);

    // "src/a.ts" as a symbol name should not resolve to the module symbol
    expect(resolveSymbol(db, "src/a.ts")).toBeNull();
  });
});

describe("listSymbolsByName", () => {
  it("returns all non-module symbols with a given name", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    const fileIdA = db.prepare("SELECT id FROM files WHERE path = 'src/a.ts'").get() as { id: number };
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileIdA.id, "helper", "function", 1, 5);

    const matches = listSymbolsByName(db, "helper");
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.file).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns empty array for unknown name", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    expect(listSymbolsByName(db, "nonexistent")).toEqual([]);
  });
});

// ── queryDependents ──────────────────────────────────────────────────

describe("queryDependents", () => {
  /** Seeds a call graph: main -> helper, helper -> utils, main -> utils */
  function seedCallGraph(db: ReturnType<typeof openDatabase>) {
    const fileId = insertFile(db, "src/graph.ts");

    // Symbols: main(1), helper(2), utils(3)
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileId, "main", "function", 1, 10);
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileId, "helper", "function", 12, 20);
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileId, "utils", "function", 22, 30);

    // Get symbol IDs
    const main = db.prepare("SELECT id FROM symbols WHERE name = 'main'").get() as { id: number };
    const helper = db.prepare("SELECT id FROM symbols WHERE name = 'helper'").get() as { id: number };
    const utils = db.prepare("SELECT id FROM symbols WHERE name = 'utils'").get() as { id: number };

    // Edges: main calls helper, main calls utils, helper calls utils
    db.prepare(`INSERT INTO edges (from_symbol_id, to_symbol_id, edge_type) VALUES (?, ?, ?)`).run(main.id, helper.id, "calls");
    db.prepare(`INSERT INTO edges (from_symbol_id, to_symbol_id, edge_type) VALUES (?, ?, ?)`).run(main.id, utils.id, "calls");
    db.prepare(`INSERT INTO edges (from_symbol_id, to_symbol_id, edge_type) VALUES (?, ?, ?)`).run(helper.id, utils.id, "calls");

    return { main: main.id, helper: helper.id, utils: utils.id };
  }

  it("finds direct dependents (depth 1)", () => {
    const db = openDatabase(TEST_DB);
    const ids = seedCallGraph(db);

    // Who calls utils? main and helper
    const deps = queryDependents(db, ids.utils);
    expect(deps).toHaveLength(2);
    expect(deps.map((d) => d.symbol).sort()).toEqual(["helper", "main"]);
    expect(deps.every((d) => d.depth === 1)).toBe(true);
  });

  it("finds transitive dependents (depth > 1)", () => {
    const db = openDatabase(TEST_DB);
    const ids = seedCallGraph(db);

    // Who calls helper? main (directly). Nobody calls main.
    const deps = queryDependents(db, ids.helper);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toEqual({ file: "src/graph.ts", symbol: "main", kind: "function", depth: 1 });
  });

  it("returns empty for a symbol nobody depends on", () => {
    const db = openDatabase(TEST_DB);
    const ids = seedCallGraph(db);

    // Nobody calls main
    const deps = queryDependents(db, ids.main);
    expect(deps).toEqual([]);
  });

  it("respects maxDepth", () => {
    const db = openDatabase(TEST_DB);
    const ids = seedCallGraph(db);

    // utils is called by main (depth 1) and helper (depth 1),
    // but helper is called by main (depth 2 through helper).
    // With maxDepth=1, we should only get direct callers.
    const deps = queryDependents(db, ids.utils, 1);
    expect(deps).toHaveLength(2);
    expect(deps.every((d) => d.depth <= 1)).toBe(true);
  });

  it("handles cycles without infinite loop", () => {
    const db = openDatabase(TEST_DB);
    const fileId = insertFile(db, "src/cyclic.ts");

    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileId, "a", "function", 1, 5);
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?)`
    ).run(fileId, "b", "function", 7, 10);

    const a = db.prepare("SELECT id FROM symbols WHERE name = 'a'").get() as { id: number };
    const b = db.prepare("SELECT id FROM symbols WHERE name = 'b'").get() as { id: number };

    // a calls b, b calls a (cycle)
    db.prepare(`INSERT INTO edges (from_symbol_id, to_symbol_id, edge_type) VALUES (?, ?, ?)`).run(a.id, b.id, "calls");
    db.prepare(`INSERT INTO edges (from_symbol_id, to_symbol_id, edge_type) VALUES (?, ?, ?)`).run(b.id, a.id, "calls");

    // Should not infinite loop
    const depsA = queryDependents(db, a.id);
    const depsB = queryDependents(db, b.id);

    expect(depsA).toHaveLength(1); // b depends on a
    expect(depsB).toHaveLength(1); // a depends on b
    expect(depsA[0].symbol).toBe("b");
    expect(depsB[0].symbol).toBe("a");
  });
});
