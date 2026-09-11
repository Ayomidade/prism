import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../../src/store/db.js";
import { buildGraph } from "../../src/graph/build-graph.js";
import type { ParsedFile } from "../../src/graph/parser.js";

// Uses hand-built ParsedFile[] fixtures rather than running the real
// parser.ts/ts-morph pipeline — buildGraph's job is graph construction and
// import resolution, not AST parsing, so this keeps the test focused on
// that boundary and stable regardless of how parser.ts evolves.
//
// resolveImport() inside build-graph.ts checks the real filesystem
// (existsSync) to resolve relative imports, so the fixture files below are
// written to a real temp directory, not held purely in memory.

const TEST_ROOT = "./test-tmp-build-graph";
const TEST_DB = `${TEST_ROOT}/graph.db`;
const FIXTURE_REPO = `${TEST_ROOT}/fixture-repo`;

function writeFixtureFiles(): void {
  mkdirSync(join(FIXTURE_REPO, "src", "sub"), { recursive: true });
  writeFileSync(join(FIXTURE_REPO, "src", "a.ts"), "export function a() {}\n");
  writeFileSync(join(FIXTURE_REPO, "src", "b.ts"), "export function b() {}\n");
  writeFileSync(join(FIXTURE_REPO, "src", "sub", "c.ts"), "export function c() {}\n");
}

// a.ts imports b.ts, sub/c.ts imports a.ts (one level up).
// b.ts imports nothing. One deliberately unresolvable import included.
const FIXTURE_FILES: ParsedFile[] = [
  { path: "src/a.ts", lineCount: 5, symbols: [], imports: ["./b.js"] },
  { path: "src/b.ts", lineCount: 3, symbols: [], imports: [] },
  { path: "src/sub/c.ts", lineCount: 4, symbols: [], imports: ["../a.js"] },
];

const FILES_WITH_DANGLING_IMPORT: ParsedFile[] = [
  ...FIXTURE_FILES,
  { path: "src/d.ts", lineCount: 2, symbols: [], imports: ["./does-not-exist.js"] },
];

beforeEach(() => {
  writeFixtureFiles();
});

afterEach(() => {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true });
  }
});

describe("buildGraph", () => {
  it("inserts one file row and one module symbol per parsed file", () => {
    const db = openDatabase(TEST_DB);
    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);

    const fileCount = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
    const symbolCount = (db.prepare("SELECT COUNT(*) as c FROM symbols").get() as { c: number }).c;
    const moduleCount = (
      db.prepare("SELECT COUNT(*) as c FROM symbols WHERE kind = 'module'").get() as { c: number }
    ).c;

    expect(fileCount).toBe(3);
    expect(symbolCount).toBe(3);
    expect(moduleCount).toBe(3);
    db.close();
  });

  it("resolves relative imports to the correct target file, including ../ paths", () => {
    const db = openDatabase(TEST_DB);
    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);

    const edges = db
      .prepare(
        `SELECT f1.path as from_path, f2.path as to_path
         FROM edges e
         JOIN symbols s1 ON e.from_symbol_id = s1.id
         JOIN symbols s2 ON e.to_symbol_id = s2.id
         JOIN files f1 ON s1.file_id = f1.id
         JOIN files f2 ON s2.file_id = f2.id`
      )
      .all() as { from_path: string; to_path: string }[];

    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual({ from_path: "src/a.ts", to_path: "src/b.ts" });
    expect(edges).toContainEqual({ from_path: "src/sub/c.ts", to_path: "src/a.ts" });
    db.close();
  });

  it("silently skips imports that don't resolve to a real file, without throwing", () => {
    const db = openDatabase(TEST_DB);

    expect(() => buildGraph(db, FILES_WITH_DANGLING_IMPORT, FIXTURE_REPO)).not.toThrow();

    const fileCount = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
    const edgeCount = (db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;

    expect(fileCount).toBe(4); // d.ts itself still gets a file + module symbol
    expect(edgeCount).toBe(2); // but no edge for the dangling import
    db.close();
  });

  it("does not duplicate symbols or edges when run multiple times (repeat prism init)", () => {
    const db = openDatabase(TEST_DB);

    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);
    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);
    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);

    const fileCount = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
    const symbolCount = (db.prepare("SELECT COUNT(*) as c FROM symbols").get() as { c: number }).c;
    const edgeCount = (db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;

    expect(fileCount).toBe(3);
    expect(symbolCount).toBe(3);
    expect(edgeCount).toBe(2);
    db.close();
  });

  it("reflects a changed import graph after re-running with different input", () => {
    const db = openDatabase(TEST_DB);

    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);
    let edgeCount = (db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;
    expect(edgeCount).toBe(2);

    // b.ts no longer exists, so a.ts's import of it should no longer resolve
    const filesWithoutB: ParsedFile[] = [
      { path: "src/a.ts", lineCount: 5, symbols: [], imports: ["./b.js"] },
      { path: "src/sub/c.ts", lineCount: 4, symbols: [], imports: ["../a.js"] },
    ];
    rmSync(join(FIXTURE_REPO, "src", "b.ts"));

    buildGraph(db, filesWithoutB, FIXTURE_REPO);
    edgeCount = (db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;

    // only c.ts -> a.ts should remain; a.ts -> b.ts can no longer resolve
    expect(edgeCount).toBe(1);
    db.close();
  });
});
