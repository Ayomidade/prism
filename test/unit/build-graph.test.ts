import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../../src/store/db.js";
import { buildGraph } from "../../src/graph/build-graph.js";
import type { ParsedFile } from "../../src/graph/parser.js";

// Uses hand-built ParsedFile[] fixtures rather than running the real
// parser.ts/ts-morph pipeline -- buildGraph's job is graph construction and
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
// b.ts imports nothing. No namedImports (no call resolution needed for these).
const FIXTURE_FILES: ParsedFile[] = [
  { path: "src/a.ts", lineCount: 5, symbols: [], imports: ["./b.js"], namedImports: [] },
  { path: "src/b.ts", lineCount: 3, symbols: [], imports: [], namedImports: [] },
  { path: "src/sub/c.ts", lineCount: 4, symbols: [], imports: ["../a.js"], namedImports: [] },
];

const FILES_WITH_DANGLING_IMPORT: ParsedFile[] = [
  ...FIXTURE_FILES,
  { path: "src/d.ts", lineCount: 2, symbols: [], imports: ["./does-not-exist.js"], namedImports: [] },
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
    const moduleCount = (
      db.prepare("SELECT COUNT(*) as c FROM symbols WHERE kind = 'module'").get() as { c: number }
    ).c;

    expect(fileCount).toBe(3);
    expect(moduleCount).toBe(3);
  });

  it("resolves relative imports to the correct target file, including ../ paths", () => {
    const db = openDatabase(TEST_DB);
    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);

    const edges = db
      .prepare(
        `SELECT f1.path as from_path, f2.path as to_path, e.edge_type
         FROM edges e
         JOIN symbols s1 ON e.from_symbol_id = s1.id
         JOIN symbols s2 ON e.to_symbol_id = s2.id
         JOIN files f1 ON s1.file_id = f1.id
         JOIN files f2 ON s2.file_id = f2.id
         WHERE e.edge_type = 'imports'`
      )
      .all() as { from_path: string; to_path: string; edge_type: string }[];

    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual({ from_path: "src/a.ts", to_path: "src/b.ts", edge_type: "imports" });
    expect(edges).toContainEqual({ from_path: "src/sub/c.ts", to_path: "src/a.ts", edge_type: "imports" });
  });

  it("silently skips imports that don't resolve to a real file, without throwing", () => {
    const db = openDatabase(TEST_DB);

    expect(() => buildGraph(db, FILES_WITH_DANGLING_IMPORT, FIXTURE_REPO)).not.toThrow();

    const fileCount = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
    const edgeCount = (
      db.prepare("SELECT COUNT(*) as c FROM edges WHERE edge_type = 'imports'").get() as { c: number }
    ).c;

    expect(fileCount).toBe(4); // d.ts itself still gets a file + module symbol
    expect(edgeCount).toBe(2); // but no edge for the dangling import
  });

  it("does not duplicate symbols or edges when run multiple times (repeat prism init)", () => {
    const db = openDatabase(TEST_DB);

    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);
    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);
    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);

    const fileCount = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
    const moduleCount = (
      db.prepare("SELECT COUNT(*) as c FROM symbols WHERE kind = 'module'").get() as { c: number }
    ).c;
    const edgeCount = (
      db.prepare("SELECT COUNT(*) as c FROM edges WHERE edge_type = 'imports'").get() as { c: number }
    ).c;

    expect(fileCount).toBe(3);
    expect(moduleCount).toBe(3);
    expect(edgeCount).toBe(2);
  });

  it("reflects a changed import graph after re-running with different input", () => {
    const db = openDatabase(TEST_DB);

    buildGraph(db, FIXTURE_FILES, FIXTURE_REPO);
    let edgeCount = (
      db.prepare("SELECT COUNT(*) as c FROM edges WHERE edge_type = 'imports'").get() as { c: number }
    ).c;
    expect(edgeCount).toBe(2);

    // b.ts no longer exists, so a.ts's import of it should no longer resolve
    const filesWithoutB: ParsedFile[] = [
      { path: "src/a.ts", lineCount: 5, symbols: [], imports: ["./b.js"], namedImports: [] },
      { path: "src/sub/c.ts", lineCount: 4, symbols: [], imports: ["../a.js"], namedImports: [] },
    ];
    rmSync(join(FIXTURE_REPO, "src", "b.ts"));

    buildGraph(db, filesWithoutB, FIXTURE_REPO);
    edgeCount = (
      db.prepare("SELECT COUNT(*) as c FROM edges WHERE edge_type = 'imports'").get() as { c: number }
    ).c;

    // only c.ts -> a.ts should remain; a.ts -> b.ts can no longer resolve
    expect(edgeCount).toBe(1);
  });

  // ── Day 4: symbol persistence + call resolution ──────────────────────

  it("persists real symbols alongside the module symbol", () => {
    const db = openDatabase(TEST_DB);
    const filesWithSymbols: ParsedFile[] = [
      {
        path: "src/a.ts", lineCount: 5, imports: ["./b.js"], namedImports: [],
        symbols: [
          { name: "doStuff", kind: "function", startLine: 1, endLine: 3, calls: [] },
        ],
      },
      { path: "src/b.ts", lineCount: 3, symbols: [], imports: [], namedImports: [] },
    ];

    buildGraph(db, filesWithSymbols, FIXTURE_REPO);

    const symbols = db
      .prepare("SELECT name, kind FROM symbols ORDER BY id")
      .all() as { name: string; kind: string }[];

    expect(symbols).toEqual([
      { name: "src/a.ts", kind: "module" },
      { name: "doStuff", kind: "function" },
      { name: "src/b.ts", kind: "module" },
    ]);
  });

  it("creates a calls edge for a locally declared function", () => {
    const db = openDatabase(TEST_DB);
    const filesWithCalls: ParsedFile[] = [
      {
        path: "src/a.ts", lineCount: 5, imports: [], namedImports: [],
        symbols: [
          { name: "helper", kind: "function", startLine: 1, endLine: 2, calls: [] },
          { name: "main", kind: "function", startLine: 4, endLine: 5, calls: ["helper"] },
        ],
      },
    ];

    buildGraph(db, filesWithCalls, FIXTURE_REPO);

    const callEdges = db
      .prepare(
        `SELECT s1.name as from_name, s2.name as to_name, e.edge_type
         FROM edges e
         JOIN symbols s1 ON e.from_symbol_id = s1.id
         JOIN symbols s2 ON e.to_symbol_id = s2.id
         WHERE e.edge_type = 'calls'`
      )
      .all() as { from_name: string; to_name: string; edge_type: string }[];

    expect(callEdges).toHaveLength(1);
    expect(callEdges[0]).toEqual({ from_name: "main", to_name: "helper", edge_type: "calls" });
  });

  it("creates a calls edge for an imported function", () => {
    const db = openDatabase(TEST_DB);
    writeFileSync(join(FIXTURE_REPO, "src", "a.ts"), "export function helper() {}\n");
    writeFileSync(join(FIXTURE_REPO, "src", "b.ts"), "export function main() { helper(); }\n");

    const filesWithImportedCalls: ParsedFile[] = [
      {
        path: "src/b.ts", lineCount: 3, imports: ["./a.js"],
        namedImports: [{ source: "./a.js", names: ["helper"] }],
        symbols: [
          { name: "main", kind: "function", startLine: 1, endLine: 3, calls: ["helper"] },
        ],
      },
      {
        path: "src/a.ts", lineCount: 1, imports: [], namedImports: [],
        symbols: [
          { name: "helper", kind: "function", startLine: 1, endLine: 1, calls: [] },
        ],
      },
    ];

    buildGraph(db, filesWithImportedCalls, FIXTURE_REPO);

    const callEdges = db
      .prepare(
        `SELECT s1.name as from_name, s2.name as to_name, f1.path as from_file, f2.path as to_file
         FROM edges e
         JOIN symbols s1 ON e.from_symbol_id = s1.id
         JOIN symbols s2 ON e.to_symbol_id = s2.id
         JOIN files f1 ON s1.file_id = f1.id
         JOIN files f2 ON s2.file_id = f2.id
         WHERE e.edge_type = 'calls'`
      )
      .all() as { from_name: string; to_name: string; from_file: string; to_file: string }[];

    expect(callEdges).toHaveLength(1);
    expect(callEdges[0]).toEqual({
      from_name: "main", to_name: "helper",
      from_file: "src/b.ts", to_file: "src/a.ts",
    });
  });

  it("does not create calls edges for external package calls", () => {
    const db = openDatabase(TEST_DB);
    const filesWithExternalCalls: ParsedFile[] = [
      {
        path: "src/a.ts", lineCount: 3, imports: [], namedImports: [],
        symbols: [
          { name: "main", kind: "function", startLine: 1, endLine: 3, calls: ["console", "process"] },
        ],
      },
    ];

    buildGraph(db, filesWithExternalCalls, FIXTURE_REPO);

    const callEdges = db
      .prepare("SELECT COUNT(*) as c FROM edges WHERE edge_type = 'calls'")
      .get() as { c: number };

    expect(callEdges.c).toBe(0);
  });

  it("does not create calls edge when callee name is ambiguous across files", () => {
    const db = openDatabase(TEST_DB);
    writeFileSync(join(FIXTURE_REPO, "src", "a.ts"), "export function helper() {}\n");
    writeFileSync(join(FIXTURE_REPO, "src", "b.ts"), "export function helper() {}\n");

    const filesWithAmbiguous: ParsedFile[] = [
      {
        path: "src/consumer.ts", lineCount: 3, imports: ["./a.js", "./b.js"],
        namedImports: [
          { source: "./a.js", names: ["helper"] },
          { source: "./b.js", names: ["helper"] },
        ],
        symbols: [
          { name: "main", kind: "function", startLine: 1, endLine: 3, calls: ["helper"] },
        ],
      },
      {
        path: "src/a.ts", lineCount: 1, imports: [], namedImports: [],
        symbols: [{ name: "helper", kind: "function", startLine: 1, endLine: 1, calls: [] }],
      },
      {
        path: "src/b.ts", lineCount: 1, imports: [], namedImports: [],
        symbols: [{ name: "helper", kind: "function", startLine: 1, endLine: 1, calls: [] }],
      },
    ];

    buildGraph(db, filesWithAmbiguous, FIXTURE_REPO);

    const callEdges = db
      .prepare("SELECT COUNT(*) as c FROM edges WHERE edge_type = 'calls'")
      .get() as { c: number };

    expect(callEdges.c).toBe(0); // ambiguous -- skip resolution
  });
});
