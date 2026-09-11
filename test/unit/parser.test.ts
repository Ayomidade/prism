import { describe, it, expect } from "vitest";
import { createProject, parseSourceFile } from "../../src/graph/parser.js";

const project = createProject(".");

describe("parseSourceFile", () => {
  it("parses functions from a real file", () => {
    const result = parseSourceFile(project, "src/store/db.ts");
    expect(result.path).toBe("src/store/db.ts");
    expect(result.lineCount).toBeGreaterThan(0);
    expect(result.symbols.length).toBeGreaterThanOrEqual(5);

    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("openDatabase");
    expect(names).toContain("getDbPath");
    expect(names).toContain("checkSchemaVersion");
  });

  it("parses exports from a real file", () => {
    const result = parseSourceFile(project, "src/store/schema.ts");
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("SCHEMA_VERSION");
    expect(names).toContain("SCHEMA_SQL");
  });

  it("parses relative imports and excludes external packages", () => {
    const result = parseSourceFile(project, "src/store/db.ts");
    // db.ts imports ./schema.js (relative) and better-sqlite3 (external)
    expect(result.imports).toContain("./schema.js");
    expect(result.imports).not.toContain("better-sqlite3");
  });

  it("parses multiple relative imports from cli/index.ts", () => {
    const result = parseSourceFile(project, "src/cli/index.ts");
    expect(result.imports).toEqual([
      "./commands/init.js",
      "./commands/why.js",
      "./commands/impact.js",
    ]);
  });

  it("returns 0 symbols for a file with only calls, no declarations", () => {
    const result = parseSourceFile(project, "src/cli/index.ts");
    // index.ts has const program and register* calls, no function/class declarations
    expect(result.symbols.length).toBe(0);
  });

  it("parses cross-directory relative imports", () => {
    const result = parseSourceFile(project, "src/graph/build-graph.ts");
    expect(result.imports).toContain("./parser.js");
    expect(result.imports).toContain("../store/repository.js");
  });

  it("assigns correct line ranges to symbols", () => {
    const result = parseSourceFile(project, "src/store/db.ts");
    const openDb = result.symbols.find((s) => s.name === "openDatabase");
    expect(openDb).toBeDefined();
    expect(openDb!.startLine).toBeGreaterThanOrEqual(73);
    expect(openDb!.endLine).toBeGreaterThan(openDb!.startLine);
  });

  // ── Day 4: named imports ───────────────────────────────────────────

  it("parses named imports with their source specifiers", () => {
    const result = parseSourceFile(project, "src/store/db.ts");
    // db.ts imports { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js"
    expect(result.namedImports).toContainEqual({
      source: "./schema.js",
      names: ["SCHEMA_SQL", "SCHEMA_VERSION"],
    });
  });

  it("excludes type-only imports from namedImports", () => {
    const result = parseSourceFile(project, "src/graph/build-graph.ts");
    // build-graph.ts imports type { ParsedFile } from parser.js -- type-only
    const parserImport = result.namedImports.find((ni) => ni.source === "./parser.js");
    expect(parserImport).toBeUndefined();
    // but the bare imports array still includes it (for file-level import edges)
    expect(result.imports).toContain("./parser.js");
  });

  it("excludes external package imports from namedImports", () => {
    const result = parseSourceFile(project, "src/store/db.ts");
    const fsImport = result.namedImports.find((ni) => ni.source === "node:fs");
    expect(fsImport).toBeUndefined();
  });

  // ── Day 4: call expressions ────────────────────────────────────────

  it("collects simple call expression names from function bodies", () => {
    const result = parseSourceFile(project, "src/store/db.ts");
    const openDb = result.symbols.find((s) => s.name === "openDatabase");
    expect(openDb).toBeDefined();
    // openDatabase calls: dirname, existsSync, mkdirSync, db.pragma, etc.
    // Only simple identifiers are captured (not db.pragma -- that's a property access)
    expect(openDb!.calls).toContain("dirname");
    expect(openDb!.calls).toContain("existsSync");
    expect(openDb!.calls).toContain("mkdirSync");
  });

  it("does not capture method calls (property access callee)", () => {
    const result = parseSourceFile(project, "src/graph/build-graph.ts");
    const buildFn = result.symbols.find((s) => s.name === "buildGraph");
    expect(buildFn).toBeDefined();
    // buildGraph calls db.exec, insertFile, etc. -- these are property access
    // calls which should NOT be captured (only simple identifiers)
    expect(buildFn!.calls).not.toContain("db.exec");
    expect(buildFn!.calls).not.toContain("moduleSymbolIds.set");
    // but insertFile, insertSymbol, resolveImport are imported bare names
    expect(buildFn!.calls).toContain("insertFile");
    expect(buildFn!.calls).toContain("insertSymbol");
    expect(buildFn!.calls).toContain("resolveImport");
  });

  it("returns empty calls array for symbols with no function body", () => {
    const result = parseSourceFile(project, "src/store/schema.ts");
    // schema.ts exports const SCHEMA_VERSION and SCHEMA_SQL -- no function bodies
    const version = result.symbols.find((s) => s.name === "SCHEMA_VERSION");
    expect(version).toBeDefined();
    expect(version!.calls).toEqual([]);
  });
});
