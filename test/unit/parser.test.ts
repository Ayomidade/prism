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
});
