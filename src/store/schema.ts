// ──────────────────────────────────────────────────────────────────────────────
// schema.ts — SQLite DDL for the local graph store
// ──────────────────────────────────────────────────────────────────────────────
//
// This file defines the complete database schema that PRISM uses to store
// everything it learns about a codebase: files, symbols, dependency edges,
// commit history, and (optionally) GitHub PR/issue links.
//
// The schema is versioned (SCHEMA_VERSION). If the code is upgraded with a
// new schema, stale databases will fail loudly (see db.ts checkSchemaVersion).
//
// Table relationships (ERD):
//
//   files ───────────────────────┐
//     │                          │
//     ├─< file_renames           │  tracks file path history through renames
//     │                          │
//     ├─< symbols ──< edges      │  symbols are nodes, edges are dependencies
//     │                          │
//     └─< commit_files ──> commits ──< pr_issue_links
//                                      (optional GitHub enrichment)
//
//   meta                        key/value store for schema version + metadata
//
// How this fits into PRISM's data flow:
//
//   1. prism init runs git log/blame + AST parsing
//   2. Parsed data is inserted into these tables via repository.ts helpers
//   3. prism why queries commit_files + commits + pr_issue_links
//   4. prism impact queries symbols + edges (reverse traversal)
//
// See also: docs/prism-v1-build-spec.md Section 3 for the full schema rationale.
// ──────────────────────────────────────────────────────────────────────────────

/** Current schema version. Increment when DDL changes require a re-index. */
export const SCHEMA_VERSION = "3"; // was "2" — added dedup indexes on symbols + edges

/**
 * Complete DDL for all PRISM tables.
 * Uses CREATE TABLE IF NOT EXISTS so it's safe to run on every `openDatabase()`.
 *
 * Tables:
 *   - files:          one row per tracked file (current and historical paths)
 *   - file_renames:   tracks file path changes through git history
 *   - symbols:        functions/classes/exports within a file (AST-derived)
 *   - edges:          dependency relationships between symbols
 *   - commits:        raw commit metadata (sha, author, date, message)
 *   - commit_files:   which files/line ranges a commit touched (from blame)
 *   - pr_issue_links: optional GitHub PR/issue context per commit
 *   - meta:           key/value store (schema version, last index timestamp)
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_files_path ON files(path);

CREATE TABLE IF NOT EXISTS file_renames (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id),
  old_path TEXT NOT NULL,
  commit_sha TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY,
  from_symbol_id INTEGER NOT NULL REFERENCES symbols(id),
  to_symbol_id INTEGER NOT NULL REFERENCES symbols(id),
  edge_type TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_dedup ON edges(from_symbol_id, to_symbol_id, edge_type);

CREATE TABLE IF NOT EXISTS commits (
  sha TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  date TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commit_files (
  id INTEGER PRIMARY KEY,
  commit_sha TEXT NOT NULL REFERENCES commits(sha),
  file_id INTEGER NOT NULL REFERENCES files(id),
  start_line INTEGER,
  end_line INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commit_files_dedup ON commit_files(commit_sha, file_id, start_line, end_line);

CREATE TABLE IF NOT EXISTS pr_issue_links (
  id INTEGER PRIMARY KEY,
  commit_sha TEXT NOT NULL REFERENCES commits(sha),
  pr_number INTEGER,
  issue_number INTEGER,
  title TEXT,
  body TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
