import type Database from "better-sqlite3";
import type { ParsedFile } from "./parser.js";
import { insertFile, insertSymbol, insertEdge } from "../store/repository.js";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Constructs the file-level dependency graph from parsed AST data.
// See docs/prism-v1-build-spec.md Section 4 (Graph Model) and Section 7
// (Indexing Pipeline, steps 4-6).
//
// Day 3 scope: file-level structure only (imports/exports).
// Function/symbol-level call resolution is Day 4.
//
// Design: every file gets an implicit "module" symbol representing the
// file as a whole (kind: "module", spanning the full file). Import edges
// connect module symbols. This keeps the edges table uniform — no schema
// change needed — and sets up Day 4 naturally: real function/class symbols
// will sit inside the same file's module symbol, and call edges will use
// the same edges table.

/**
 * Builds the file-level dependency graph from parsed source files.
 *
 * For each file:
 *   1. Inserts the file row (dedup via unique index)
 *   2. Inserts a "module" symbol representing the file as a whole
 *   3. Resolves each relative import to an actual file path
 *   4. Inserts an "imports" edge from this file's module symbol to the
 *      target file's module symbol
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
  // Files are NOT wiped — insertFile's unique index handles dedup safely.
  // This matches the v1 "full re-index on every init" model from the build spec.
  db.exec("DELETE FROM edges");
  db.exec("DELETE FROM symbols");

  // First pass: insert all files and their module symbols.
  // We need the module symbol IDs before we can create import edges.
  const moduleSymbolIds = new Map<string, number>(); // path → symbol ID

  for (const file of files) {
    const fileId = insertFile(db, file.path);

    // Insert the implicit "module" symbol for this file
    const moduleSymbolId = insertSymbol(
      db,
      fileId,
      file.path, // name is the file path itself
      "module",
      1,
      file.lineCount
    );

    moduleSymbolIds.set(file.path, moduleSymbolId);
  }

  // Second pass: resolve imports and insert edges.
  for (const file of files) {
    const fromSymbolId = moduleSymbolIds.get(file.path);
    if (!fromSymbolId) continue; // shouldn't happen, but defensive

    for (const importPath of file.imports) {
      const resolvedPath = resolveImport(importPath, file.path, repoRoot);
      if (!resolvedPath) continue; // unresolvable — skip silently

      const toSymbolId = moduleSymbolIds.get(resolvedPath);
      if (!toSymbolId) continue; // target file not in the parsed set

      insertEdge(db, fromSymbolId, toSymbolId, "imports");
    }
  }
}

/**
 * Resolves a relative import specifier to an actual file path within the repo.
 *
 * Handles TypeScript's common import patterns:
 *   - ./foo.js → ./foo.ts (JS extensions in TS source)
 *   - ./foo   → ./foo.ts or ./foo/index.ts (bare directory imports)
 *   - ../bar  → ../bar.ts (relative parent imports)
 *
 * @param importSpecifier - The raw import path (e.g. "./schema.js")
 * @param fromFile        - Path of the file doing the importing
 * @param repoRoot        - Absolute path to the repo root
 * @returns Resolved path relative to repo root, or null if unresolvable
 */
function resolveImport(
  importSpecifier: string,
  fromFile: string,
  repoRoot: string
): string | null {
  const fromDir = dirname(fromFile);
  const target = join(fromDir, importSpecifier);

  // Try common TypeScript/JavaScript extensions and index files
  const candidates = [
    // Exact path (rarely works but free to try)
    target,
    // .js → .ts (TypeScript source often uses .js extensions)
    target.replace(/\.js$/, ".ts"),
    // .js → .tsx
    target.replace(/\.js$/, ".tsx"),
    // .jsx → .tsx
    target.replace(/\.jsx$/, ".tsx"),
    // Bare path → index.ts
    join(target, "index.ts"),
    // Bare path → index.tsx
    join(target, "index.tsx"),
    // Bare path → index.js
    join(target, "index.js"),
  ];

  for (const candidate of candidates) {
    const absolute = resolve(repoRoot, candidate);
    if (existsSync(absolute)) {
      return candidate;
    }
  }

  return null; // nothing matched
}
