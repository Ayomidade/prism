import { describe, it, expect, afterEach } from "vitest";
import { openDatabase } from "../../src/store/db.js";
import { insertFile, insertCommit, insertSymbol, insertEdge } from "../../src/store/repository.js";
import { rmSync, existsSync } from "node:fs";

const TEST_DB_DIR = "./test-tmp-repo";
const TEST_DB = `${TEST_DB_DIR}/graph.db`;

afterEach(() => {
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true });
  }
});

describe("insertFile", () => {
  it("returns the same id when inserting the same path twice", () => {
    const db = openDatabase(TEST_DB);
    const id1 = insertFile(db, "src/store/db.ts");
    const id2 = insertFile(db, "src/store/db.ts");
    expect(id1).toBe(id2);
  });

  it("does not create duplicate rows for the same path", () => {
    const db = openDatabase(TEST_DB);
    insertFile(db, "src/store/db.ts");
    insertFile(db, "src/store/db.ts");
    insertFile(db, "src/store/db.ts");

    const count = db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("gives different paths different ids", () => {
    const db = openDatabase(TEST_DB);
    const id1 = insertFile(db, "src/store/db.ts");
    const id2 = insertFile(db, "src/store/schema.ts");
    expect(id1).not.toBe(id2);
  });
});

describe("insertCommit", () => {
  it("inserts a commit and it's retrievable", () => {
    const db = openDatabase(TEST_DB);
    insertCommit(db, "abc123", "Jane Doe", "2026-01-01T00:00:00Z", "Initial commit");

    const row = db.prepare("SELECT * FROM commits WHERE sha = ?").get("abc123") as
      | { sha: string; author: string; message: string }
      | undefined;

    expect(row?.author).toBe("Jane Doe");
    expect(row?.message).toBe("Initial commit");
  });

  it("ignores re-inserting the same sha instead of erroring", () => {
    const db = openDatabase(TEST_DB);
    insertCommit(db, "abc123", "Jane Doe", "2026-01-01T00:00:00Z", "Initial commit");

    // Same sha "seen" again, e.g. from a second file touched by the same commit
    expect(() =>
      insertCommit(db, "abc123", "Jane Doe", "2026-01-01T00:00:00Z", "Initial commit")
    ).not.toThrow();

    const count = db.prepare("SELECT COUNT(*) as c FROM commits").get() as { c: number };
    expect(count.c).toBe(1);
  });
});

describe("insertSymbol / insertEdge", () => {
  it("inserts a symbol tied to a file", () => {
    const db = openDatabase(TEST_DB);
    const fileId = insertFile(db, "src/store/db.ts");
    const symbolId = insertSymbol(db, fileId, "openDatabase", "function", 10, 30);

    const row = db.prepare("SELECT * FROM symbols WHERE id = ?").get(symbolId) as
      | { name: string; kind: string }
      | undefined;

    expect(row?.name).toBe("openDatabase");
    expect(row?.kind).toBe("function");
  });

  it("inserts an edge between two symbols", () => {
    const db = openDatabase(TEST_DB);
    const fileId = insertFile(db, "src/store/db.ts");
    const fromId = insertSymbol(db, fileId, "openDatabase", "function", 10, 30);
    const toId = insertSymbol(db, fileId, "checkSchemaVersion", "function", 40, 50);

    expect(() => insertEdge(db, fromId, toId, "calls")).not.toThrow();

    const row = db.prepare("SELECT * FROM edges WHERE from_symbol_id = ?").get(fromId) as
      | { to_symbol_id: number; edge_type: string }
      | undefined;

    expect(row?.to_symbol_id).toBe(toId);
    expect(row?.edge_type).toBe("calls");
  });
});
