import type Database from "better-sqlite3";

// ──────────────────────────────────────────────────────────────────────────────
// repository.ts — Read/write helpers for graph data
// ──────────────────────────────────────────────────────────────────────────────
//
// This module is a thin data-access layer over the SQLite database. It keeps
// raw SQL out of the ingestion/ and graph/ modules, so those layers work with
// typed functions instead of writing SQL strings.
//
// Every function here corresponds to a single table insert operation. They
// are called during `prism init` by the indexing pipeline (build-graph.ts)
// and the git ingestion layer.
//
// Current state: all functions are stubbed (throw "not implemented yet").
// These will be filled in as part of Day 1-3 of the build plan.
//
// Data flow:
//
//   ingestion/git/log.ts  ──► ParsedCommit[]
//   ingestion/git/blame.ts ──► BlameLine[]
//   graph/parser.ts       ──► ParsedFile[]
//           │
//           ▼
//   graph/build-graph.ts  ──► calls repository.ts insert*() functions
//           │
//           ▼
//   .prism/graph.db (via db.ts connection)
//
// See also: docs/prism-v1-build-spec.md Section 3 for the schema these
// functions operate on, and Section 7 (steps 4-6) for how they're called.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Inserts a file record into the `files` table.
 *
 * Called during init when a new source file is encountered. If the file
 * path already exists, this should either return the existing ID or
 * handle the duplicate gracefully (exact behavior TBD).
 *
 * @param db   - Open SQLite database connection
 * @param path - Relative path to the file (e.g. "src/foo.ts")
 * @returns The row ID of the inserted (or existing) file record
 */
export function insertFile(_db: Database.Database, _path: string): number {
  // TODO: INSERT INTO files (path) VALUES (?) RETURNING id
  throw new Error("insertFile: not implemented yet");
}

/**
 * Inserts a symbol record (function, class, export, or variable) into the
 * `symbols` table.
 *
 * Symbols are extracted from the AST (via graph/parser.ts) and represent
 * the "nodes" in the dependency graph. Each symbol knows its file, name,
 * kind, and line range.
 *
 * @param db        - Open SQLite database connection
 * @param fileId    - The file ID this symbol belongs to (from insertFile)
 * @param name      - Symbol name (e.g. "getUserById")
 * @param kind      - One of: "function", "class", "export", "variable"
 * @param startLine - First line of the symbol definition
 * @param endLine   - Last line of the symbol definition
 * @returns The row ID of the inserted symbol record
 */
export function insertSymbol(
  _db: Database.Database,
  _fileId: number,
  _name: string,
  _kind: string,
  _startLine: number,
  _endLine: number,
): number {
  // TODO: INSERT INTO symbols (file_id, name, kind, start_line, end_line) VALUES (?, ?, ?, ?, ?) RETURNING id
  throw new Error("insertSymbol: not implemented yet");
}

/**
 * Inserts an edge record into the `edges` table.
 *
 * Edges represent dependency relationships between symbols:
 *   - "imports":  file A imports from file B
 *   - "calls":    function A calls function B
 *   - "extends":  class A extends class B
 *
 * The direction convention is: from_symbol → to_symbol means "from depends on to".
 * The `impact` command traverses edges in REVERSE to find who depends on a symbol.
 *
 * @param db            - Open SQLite database connection
 * @param fromSymbolId  - The dependent symbol (the one that imports/calls)
 * @param toSymbolId    - The dependency (the one being imported/called)
 * @param edgeType      - One of: "imports", "calls", "extends"
 */
export function insertEdge(
  _db: Database.Database,
  _fromSymbolId: number,
  _toSymbolId: number,
  _edgeType: string,
): void {
  // TODO: INSERT INTO edges (from_symbol_id, to_symbol_id, edge_type) VALUES (?, ?, ?)
  throw new Error("insertEdge: not implemented yet");
}

/**
 * Inserts a commit record into the `commits` table.
 *
 * Commits are parsed from `git log` output (via ingestion/git/log.ts).
 * Each commit stores its SHA, author, date, and message — this is the
 * raw data that `prism why` queries to explain why code exists.
 *
 * @param db      - Open SQLite database connection
 * @param sha     - Full commit SHA (40 chars)
 * @param author  - Commit author name/email
 * @param date    - ISO 8601 timestamp
 * @param message - Full commit message (first line only or full body TBD)
 */
export function insertCommit(
  _db: Database.Database,
  _sha: string,
  _author: string,
  _date: string,
  _message: string,
): void {
  // TODO: INSERT INTO commits (sha, author, date, message) VALUES (?, ?, ?, ?)
  throw new Error("insertCommit: not implemented yet");
}
