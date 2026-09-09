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

// Direct lookup of commit_files rows overlapping the given file/line range.
export function queryHistoryForLocation(
  _db: Database.Database,
  _filePath: string,
  _line: number
): HistoryEntry[] {
  // TODO: implement per docs/prism-v1-build-spec.md Section 4
  throw new Error("queryHistoryForLocation: not implemented yet");
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
