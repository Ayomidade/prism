import type Database from "better-sqlite3";

// Query layer for `why` (commit history lookup) and `impact` (reverse
// dependency traversal). See docs/prism-v1-build-spec.md Section 4 (Graph Model).

export interface HistoryEntry {
  commitSha: string;
  message: string;
  date: string;
  author: string;
}

export interface Dependent {
  file: string;
  symbol: string;
  depth: number;
}

/**
 * Looks up commit history for a specific file and line.
 *
 * Finds all commit_files rows where the given line falls within the
 * committed line range, joined to commit metadata, ordered most recent first.
 *
 * @param db       - Open SQLite database
 * @param filePath - File path relative to repo root (e.g. "src/foo.ts")
 * @param line     - 1-based line number
 * @returns Array of history entries, most recent first
 */
export function queryHistoryForLocation(
  db: Database.Database,
  filePath: string,
  line: number
): HistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT c.sha as commitSha, c.message, c.date, c.author
       FROM commit_files cf
       JOIN commits c ON cf.commit_sha = c.sha
       JOIN files f ON cf.file_id = f.id
       WHERE f.path = ?
         AND cf.start_line <= ?
         AND (cf.end_line >= ? OR cf.end_line IS NULL)
       ORDER BY c.date DESC`
    )
    .all(filePath, line, line) as HistoryEntry[];

  return rows;
}

/**
 * Looks up commit history for a function/symbol by name.
 *
 * Resolves the symbol to its file and line range, then queries
 * commit_files for any commits that touched those lines.
 *
 * @param db           - Open SQLite database
 * @param functionName - Symbol name (e.g. "openDatabase")
 * @returns Array of history entries, most recent first
 */
export function queryHistoryForFunction(
  db: Database.Database,
  functionName: string
): HistoryEntry[] {
  // Find the symbol — skip module symbols (kind = "module") since those
  // represent entire files, not specific functions.
  const symbol = db
    .prepare(
      `SELECT s.file_id, s.start_line, s.end_line, f.path
       FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE s.name = ? AND s.kind != 'module'
       LIMIT 1`
    )
    .get(functionName) as
    | { file_id: number; start_line: number; end_line: number; path: string }
    | undefined;

  if (!symbol) return [];

  // Query commits that touched any line in the symbol's range
  const rows = db
    .prepare(
      `SELECT c.sha as commitSha, c.message, c.date, c.author
       FROM commit_files cf
       JOIN commits c ON cf.commit_sha = c.sha
       WHERE cf.file_id = ?
         AND cf.start_line <= ?
         AND (cf.end_line >= ? OR cf.end_line IS NULL)
       ORDER BY c.date DESC`
    )
    .all(symbol.file_id, symbol.end_line, symbol.start_line) as HistoryEntry[];

  return rows;
}

// Breadth-first traversal of reverse edges (who points to this symbol),
// de-duplicated to avoid cycles.
export function queryDependents(
  _db: Database.Database,
  _symbolName: string
): Dependent[] {
  // TODO: implement per docs/prism-v1-build-spec.md Section 4
  throw new Error("queryDependents: not implemented yet");
}
