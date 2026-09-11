import type Database from "better-sqlite3";
import type { ParsedFile } from "./parser.js";
import { insertFile, insertSymbol, insertEdge } from "../store/repository.js";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Constructs the dependency graph from parsed AST data.
// See docs/prism-v1-build-spec.md Section 4 (Graph Model) and Section 7
// (Indexing Pipeline, steps 4-6).
//
// Day 3: file-level structure only (module symbols + import edges).
// Day 4: real function/class symbols + call edges.
//
// Design: every file gets an implicit "module" symbol representing the
// file as a whole (kind: "module", spanning the full file). Import edges
// connect module symbols. Call edges connect real function/class symbols.

/**
 * Builds the dependency graph from parsed source files.
 *
 * For each file:
 *   1. Inserts the file row (dedup via unique index)
 *   2. Inserts a "module" symbol representing the file as a whole
 *   3. Inserts real symbols (functions, classes, exports)
 *   4. Resolves each relative import to an actual file path
 *   5. Inserts "imports" edges from this file's module symbol to the
 *      target file's module symbol
 *   6. Resolves call expressions and inserts "calls" edges
 *
 * @param db       - Open SQLite database connection
 * @param files    - Parsed source files from parser.ts
 * @param repoRoot - Absolute path to the repo root (for resolving imports)
 */
export function buildGraph(
  db: Database.Database,
  files: ParsedFile[],
  repoRoot: string
): void {
  // Full re-index: wipe symbols and edges, rebuild from scratch.
  // Files are NOT wiped -- insertFile's unique index handles dedup safely.
  db.exec("DELETE FROM edges");
  db.exec("DELETE FROM symbols");

  // Pass 1: insert files, module symbols, and real symbols.
  // Build lookup maps needed for pass 2 (edge creation).
  const moduleSymbolIds = new Map<string, number>(); // path -> module symbol ID
  const fileSymbolNames = new Map<string, Map<string, number>>(); // path -> {name -> symbolId}

  for (const file of files) {
    const fileId = insertFile(db, file.path);

    // Insert the implicit "module" symbol for this file
    const moduleSymbolId = insertSymbol(
      db,
      fileId,
      file.path,
      "module",
      1,
      file.lineCount
    );
    moduleSymbolIds.set(file.path, moduleSymbolId);

    // Insert real symbols (functions, classes, exports)
    const symbolNames = new Map<string, number>();
    for (const sym of file.symbols) {
      const symId = insertSymbol(db, fileId, sym.name, sym.kind, sym.startLine, sym.endLine);
      symbolNames.set(sym.name, symId);
    }
    fileSymbolNames.set(file.path, symbolNames);
  }

  // Pass 2: build import-name-to-file resolution map.
  // For each named import (e.g. { SCHEMA_SQL } from "./schema.js"),
  // resolve the source to a file path and record which file provides each name.
  const importNameToFile = new Map<string, string>(); // imported name -> file path
  for (const file of files) {
    for (const ni of file.namedImports) {
      const resolvedPath = resolveImport(ni.source, file.path, repoRoot);
      if (!resolvedPath) continue;
      for (const name of ni.names) {
        // First writer wins -- if multiple files export the same name,
        // we skip resolution for that name (ambiguous).
        if (importNameToFile.has(name)) {
          importNameToFile.set(name, ""); // empty = ambiguous
        } else {
          importNameToFile.set(name, resolvedPath);
        }
      }
    }
  }

  // Pass 3: insert edges (imports + calls).
  for (const file of files) {
    const fromModuleId = moduleSymbolIds.get(file.path);
    if (!fromModuleId) continue;

    // Import edges (file module -> file module)
    for (const importPath of file.imports) {
      const resolvedPath = resolveImport(importPath, file.path, repoRoot);
      if (!resolvedPath) continue;

      const toModuleId = moduleSymbolIds.get(resolvedPath);
      if (!toModuleId) continue;

      insertEdge(db, fromModuleId, toModuleId, "imports");
    }

    // Call edges (symbol -> symbol)
    const localSymbols = fileSymbolNames.get(file.path);
    if (!localSymbols) continue;

    for (const sym of file.symbols) {
      const fromSymId = localSymbols.get(sym.name);
      if (!fromSymId) continue;

      for (const calleeName of sym.calls) {
        const toSymId = resolveCallTarget(
          calleeName,
          file.path,
          localSymbols,
          importNameToFile,
          fileSymbolNames
        );
        if (toSymId) {
          insertEdge(db, fromSymId, toSymId, "calls");
        }
      }
    }
  }
}

/**
 * Resolves a call target (simple identifier) to a symbol ID.
 *
 * Resolution order:
 *   1. Local declaration in the same file
 *   2. Named import resolved to a specific file's symbol
 *   3. Unresolved (external package, built-in, or ambiguous) -> skip
 */
function resolveCallTarget(
  calleeName: string,
  currentFile: string,
  localSymbols: Map<string, number>,
  importNameToFile: Map<string, string>,
  fileSymbolNames: Map<string, Map<string, number>>
): number | null {
  // 1. Local declaration
  const localId = localSymbols.get(calleeName);
  if (localId) return localId;

  // 2. Imported from another file
  const targetFile = importNameToFile.get(calleeName);
  if (targetFile && targetFile !== "") {
    const targetSymbols = fileSymbolNames.get(targetFile);
    if (targetSymbols) {
      // Look for the exported symbol by name in the target file
      const targetId = targetSymbols.get(calleeName);
      if (targetId) return targetId;
    }
  }

  return null; // unresolved
}

/**
 * Resolves a relative import specifier to an actual file path within the repo.
 *
 * Handles TypeScript's common import patterns:
 *   - ./foo.js -> ./foo.ts (JS extensions in TS source)
 *   - ./foo   -> ./foo.ts or ./foo/index.ts (bare directory imports)
 *   - ../bar  -> ../bar.ts (relative parent imports)
 */
function resolveImport(
  importSpecifier: string,
  fromFile: string,
  repoRoot: string
): string | null {
  const fromDir = dirname(fromFile);
  const target = join(fromDir, importSpecifier);

  const candidates = [
    target,
    target.replace(/\.js$/, ".ts"),
    target.replace(/\.js$/, ".tsx"),
    target.replace(/\.jsx$/, ".tsx"),
    join(target, "index.ts"),
    join(target, "index.tsx"),
    join(target, "index.js"),
  ];

  for (const candidate of candidates) {
    const absolute = resolve(repoRoot, candidate);
    if (existsSync(absolute)) {
      return candidate;
    }
  }

  return null;
}
