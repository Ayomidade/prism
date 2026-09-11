import { describe, it, expect, afterEach } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { openDatabase } from "../../src/store/db.js";
import { queryHistoryForLocation, queryHistoryForFunction } from "../../src/graph/query.js";
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
    db.close();
  });

  it("returns empty array for a line with no history", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // Line 100 of a.ts was never touched
    const history = queryHistoryForLocation(db, "src/a.ts", 100);
    expect(history).toEqual([]);
    db.close();
  });

  it("returns empty array for a file that doesn't exist in the database", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    const history = queryHistoryForLocation(db, "src/missing.ts", 1);
    expect(history).toEqual([]);
    db.close();
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
    db.close();
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
    db.close();
  });

  it("returns empty array for an unknown function name", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    const history = queryHistoryForFunction(db, "nonexistent");
    expect(history).toEqual([]);
    db.close();
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
    db.close();
  });

  it("resolves checkSchemaVersion correctly (line 55-70)", () => {
    const db = openDatabase(TEST_DB);
    seedDb(db);

    // checkSchemaVersion is lines 55-70, touched by aaa1111 and ccc3333
    const history = queryHistoryForFunction(db, "checkSchemaVersion");

    expect(history).toHaveLength(2);
    expect(history[0].commitSha).toBe("ccc3333"); // most recent
    expect(history[1].commitSha).toBe("aaa1111");
    db.close();
  });
});
