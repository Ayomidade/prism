import { describe, it, expect, afterEach } from "vitest";
import {
  openDatabase,
  checkSchemaVersion,
  getDbPath,
} from "../../src/store/db.js";
import { rmSync, existsSync } from "node:fs";

// ──────────────────────────────────────────────────────────────────────────────
// db.test.ts — Unit tests for the SQLite connection layer
// ──────────────────────────────────────────────────────────────────────────────
//
// Tests verify that:
//   1. openDatabase creates the db and all required tables.
//   2. Schema version is stamped on first run.
//   3. checkSchemaVersion returns true for a fresh database.
//   4. Re-opening an existing database doesn't throw (idempotent).
//   5. Schema version mismatch throws a clear error.
//   6. getDbPath returns the correct path.
//
// Uses a temporary test directory that is cleaned up after each test.
// ──────────────────────────────────────────────────────────────────────────────

const TEST_DB_DIR = "./test-tmp";
const TEST_DB = `${TEST_DB_DIR}/graph.db`;

afterEach(() => {
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true });
  }
});

describe("openDatabase", () => {
  it("creates the .tracecode directory and database file", () => {
    const db = openDatabase(TEST_DB);
    expect(existsSync(TEST_DB)).toBe(true);
  });

  it("creates all required tables", () => {
    const db = openDatabase(TEST_DB);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("files");
    expect(tableNames).toContain("file_renames");
    expect(tableNames).toContain("symbols");
    expect(tableNames).toContain("edges");
    expect(tableNames).toContain("commits");
    expect(tableNames).toContain("commit_files");
    expect(tableNames).toContain("pr_issue_links");
    expect(tableNames).toContain("meta");
  });

  it("stamps schema_version in meta on first run", () => {
    const db = openDatabase(TEST_DB);
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };

    expect(row.value).toBe("3");
  });

  it("checkSchemaVersion returns true for a fresh database", () => {
    const db = openDatabase(TEST_DB);
    expect(checkSchemaVersion(db)).toBe(true);
  });

  it("re-opening an existing database is idempotent", () => {
    const db1 = openDatabase(TEST_DB);
    // Don't call close — just open again; WAL mode allows concurrent readers
    const db2 = openDatabase(TEST_DB);
    expect(checkSchemaVersion(db2)).toBe(true);
  });

  it("throws on schema version mismatch", () => {
    // First open: stamps current version
    const db1 = openDatabase(TEST_DB);

    // Tamper with the stored version to simulate an upgraded codebase
    db1
      .prepare("UPDATE meta SET value = '999' WHERE key = 'schema_version'")
      .run();

    // Now openDatabase should throw because code expects current version, db has v999
    expect(() => openDatabase(TEST_DB)).toThrow("out of date");
    expect(() => openDatabase(TEST_DB)).toThrow("found v999");
    expect(() => openDatabase(TEST_DB)).toThrow("tracecode init --refresh");
  });

  it("enables WAL mode", () => {
    const db = openDatabase(TEST_DB);
    const result = db.pragma("journal_mode", { simple: true }) as string;
    expect(result).toBe("wal");
  });

  it("enables foreign key enforcement", () => {
    const db = openDatabase(TEST_DB);
    const result = db.pragma("foreign_keys", { simple: true }) as number;
    expect(result).toBe(1);
  });
});

describe("getDbPath", () => {
  it("returns <repoRoot>/.tracecode/graph.db", () => {
    expect(getDbPath("/home/user/my-repo")).toBe(
      "/home/user/my-repo/.tracecode/graph.db",
    );
  });
});
