import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

// ──────────────────────────────────────────────────────────────────────────────
// db.ts — SQLite connection and initialization for .prism/graph.db
// ──────────────────────────────────────────────────────────────────────────────
//
// This is the database layer for PRISM. Every other module (graph/, ingestion/,
// summarize/) reads from or writes to the SQLite database that this module
// manages.
//
// Responsibilities:
//   1. Create the .prism/ directory if it doesn't exist (fresh repo).
//   2. Open/create the SQLite database file.
//   3. Apply the schema (idempotent CREATE TABLE IF NOT EXISTS).
//   4. Check and enforce schema versioning so stale caches fail loudly.
//
// How it fits into the data flow:
//
//   prism init
//       │
//       ├── git log/blame ──► ingestion/git/
//       ├── AST parse     ──► graph/parser.ts
//       └── GitHub API    ──► ingestion/github/
//              │
//              ▼
//   db.ts ──► openDatabase(dbPath)
//              │
//              ▼
//         .prism/graph.db  (all data lives here)
//              │
//   prism why / prism impact
//              │
//              ▼
//         graph/query.ts reads from the same db
//
// Key design decisions:
//   - WAL mode: write-ahead logging allows concurrent reads while init writes.
//   - foreign_keys ON: SQLite disables FK enforcement by default; without this,
//     the REFERENCES in schema.ts are decorative, not enforced.
//   - Schema versioning: stored in the `meta` table. If the code is upgraded
//     but the db is stale, we throw a clear error telling the user to re-init.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns the default path for the SQLite database inside a repo.
 * Creates a path like `/path/to/repo/.prism/graph.db`.
 *
 * @param repoRoot - The absolute path to the git repository root
 * @returns The full path to the SQLite database file
 */
export function getDbPath(repoRoot: string): string {
  return join(repoRoot, ".prism", "graph.db");
}

/**
 * Opens (or creates) the SQLite database at the given path.
 *
 * Steps:
 *   1. Ensures the parent directory exists (creates .prism/ if needed).
 *   2. Opens the database with WAL mode and foreign keys enabled.
 *   3. Runs the schema DDL (idempotent — CREATE TABLE IF NOT EXISTS).
 *   4. Checks the stored schema version against the current SCHEMA_VERSION.
 *      - If fresh DB: stamps it with the current version.
 *      - If version mismatch: closes db and throws an actionable error.
 *
 * @param dbPath - Absolute path to the .prism/graph.db file
 * @returns An open Database connection ready for use
 * @throws If the stored schema version doesn't match the code's expected version
 */
export function openDatabase(dbPath: string): Database.Database {
  // .prism/ may not exist on a fresh repo — create the parent directory first
  // so better-sqlite3 doesn't fail trying to open a file in a non-existent dir.
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // WAL mode: allows concurrent reads while the init command is writing.
  // Standard practice for SQLite CLI tools.
  db.pragma("journal_mode = WAL");

  // Foreign keys are OFF by default in SQLite. Without this pragma,
  // the REFERENCES clauses in schema.ts are ignored — data integrity
  // would depend entirely on the application code.
  db.pragma("foreign_keys = ON");

  // Deduplicate edges and symbols before applying unique indexes.
  // Previous schema versions didn't have unique constraints, so re-running
  // init could have created duplicate rows. This migration is safe to run
  // on every open — it's a no-op when there are no duplicates.
  deduplicateEdges(db);
  deduplicateSymbols(db);

  // Schema DDL uses CREATE TABLE IF NOT EXISTS, so this is safe to run
  // on every open — it's a no-op if the tables already exist.
  db.exec(SCHEMA_SQL);

  // Schema version check: prevents silent corruption when code is upgraded
  // but the database still has an old schema.
  const storedVersion = getStoredSchemaVersion(db);

  if (storedVersion === null) {
    // Fresh database — stamp it with the current schema version so future
    // runs can detect staleness.
    setStoredSchemaVersion(db, SCHEMA_VERSION);
  } else if (storedVersion !== SCHEMA_VERSION) {
    // Stale database — close it and tell the user exactly what to do.
    db.close();
    throw new Error(
      `PRISM database schema is out of date (found v${storedVersion}, expected v${SCHEMA_VERSION}). ` +
        `Run "prism init --refresh" to rebuild the index.`,
    );
  }

  return db;
}

/**
 * Checks whether the database's stored schema version matches the current
 * code's expected version. Useful as a guard before running queries.
 *
 * @param db - An open SQLite database connection
 * @returns true if versions match, false otherwise
 */
export function checkSchemaVersion(db: Database.Database): boolean {
  return getStoredSchemaVersion(db) === SCHEMA_VERSION;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Reads the schema version from the meta table.
 * Returns null if the meta table is empty (fresh database).
 */
function getStoredSchemaVersion(db: Database.Database): string | null {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Writes (or updates) the schema version in the meta table.
 * Uses UPSERT so it works on both first run and subsequent runs.
 */
function setStoredSchemaVersion(db: Database.Database, version: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(version);
}

/**
 * Removes duplicate edges before creating the unique index.
 * Keeps the row with the lowest id for each (from, to, type) combination.
 */
function deduplicateEdges(db: Database.Database): void {
  // Check if edges table exists (it won't on a fresh DB)
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edges'")
    .get();
  if (!tableExists) return;

  // Check if the unique index already exists (no dedup needed)
  const indexExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_edges_dedup'")
    .get();
  if (indexExists) return;

  // Remove duplicates: keep the lowest id for each unique edge
  db.exec(`
    DELETE FROM edges WHERE id NOT IN (
      SELECT MIN(id) FROM edges GROUP BY from_symbol_id, to_symbol_id, edge_type
    )
  `);
}

/**
 * Removes duplicate symbols before the application logic runs.
 * Keeps the row with the lowest id for each unique symbol definition.
 */
function deduplicateSymbols(db: Database.Database): void {
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='symbols'")
    .get();
  if (!tableExists) return;

  // Remove duplicates: keep the lowest id for each unique symbol
  db.exec(`
    DELETE FROM symbols WHERE id NOT IN (
      SELECT MIN(id) FROM symbols GROUP BY file_id, name, kind, start_line, end_line
    )
  `);
}
