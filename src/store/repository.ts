import type Database from "better-sqlite3";

// Read/write helpers for graph data. Keeps raw SQL out of the graph/ and
// ingestion/ layers. See docs/prism-v1-build-spec.md Section 3 for the schema
// these methods operate on.

/**
 * Inserts a file by path, or returns the existing row's id if the path
 * is already known. Atomic — relies on the unique index on files.path
 * (schema v2) so re-indexing the same file across many commits doesn't
 * create duplicate rows.
 */
export function insertFile(db: Database.Database, path: string): number {
  const row = db
    .prepare(
      `INSERT INTO files (path) VALUES (?)
       ON CONFLICT(path) DO UPDATE SET path = excluded.path
       RETURNING id`,
    )
    .get(path) as { id: number };

  return row.id;
}

/**
 * Inserts a symbol (function/class/export/variable) within a file.
 */
export function insertSymbol(
  db: Database.Database,
  fileId: number,
  name: string,
  kind: string,
  startLine: number,
  endLine: number,
): number {
  const row = db
    .prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(fileId, name, kind, startLine, endLine) as { id: number };

  return row.id;
}

/**
 * Inserts a dependency edge between two symbols.
 */
export function insertEdge(
  db: Database.Database,
  fromSymbolId: number,
  toSymbolId: number,
  edgeType: string,
): void {
  db.prepare(
    `INSERT INTO edges (from_symbol_id, to_symbol_id, edge_type)
     VALUES (?, ?, ?)`,
  ).run(fromSymbolId, toSymbolId, edgeType);
}

/**
 * Inserts a commit. Uses INSERT OR IGNORE since the same commit SHA will
 * be encountered once per file it touches during ingestion — sha is
 * already the primary key (schema v1), so no schema change was needed
 * here, unlike insertFile.
 */
export function insertCommit(
  db: Database.Database,
  sha: string,
  author: string,
  date: string,
  message: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO commits (sha, author, date, message)
     VALUES (?, ?, ?, ?)`,
  ).run(sha, author, date, message);
}
