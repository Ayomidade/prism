import type Database from "better-sqlite3";

// Query layer for `why` (commit history lookup) and `impact` (reverse
// dependency traversal). See docs/prism-v1-build-spec.md Section 4 (Graph Model).

export interface HistoryEntry {
  commitSha: string;
  message: string;
  date: string;
  author: string;
  prNumbers: number[];
  prTitles: string[];
}

export interface Dependent {
  file: string;
  symbol: string;
  depth: number;
}

export interface ResolvedSymbol {
  id: number;
  name: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
}

// ── Symbol resolution ────────────────────────────────────────────────

/**
 * Resolves a symbol by name, optionally disambiguated by file path.
 *
 * Accepts two formats:
 *   - "openDatabase" — looks up by name, fails if ambiguous
 *   - "src/db.ts:openDatabase" — looks up by file + name
 *
 * @returns Resolved symbol, or null if not found
 */
export function resolveSymbol(
  db: Database.Database,
  target: string
): ResolvedSymbol | null {
  const colonIdx = target.lastIndexOf(":");
  const hasFilePrefix = colonIdx > 0 && target.substring(0, colonIdx).includes("/");

  if (hasFilePrefix) {
    const file = target.substring(0, colonIdx);
    const name = target.substring(colonIdx + 1);
    return resolveByFileAndName(db, file, name);
  }

  return resolveByName(db, target);
}

function resolveByFileAndName(
  db: Database.Database,
  file: string,
  name: string
): ResolvedSymbol | null {
  const row = db
    .prepare(
      `SELECT s.id, s.name, s.kind, f.path as file, s.start_line, s.end_line
       FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE f.path = ? AND s.name = ? AND s.kind != 'module'
       LIMIT 1`
    )
    .get(file, name) as ResolvedSymbol | undefined;

  return row ?? null;
}

function resolveByName(
  db: Database.Database,
  name: string
): ResolvedSymbol | null {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.kind, f.path as file, s.start_line, s.end_line
       FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE s.name = ? AND s.kind != 'module'`
    )
    .all(name) as ResolvedSymbol[];

  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  // Ambiguous — return null, caller should list matches
  return null;
}

/**
 * Lists all non-module symbols matching a name (for ambiguity reporting).
 */
export function listSymbolsByName(
  db: Database.Database,
  name: string
): ResolvedSymbol[] {
  return db
    .prepare(
      `SELECT s.id, s.name, s.kind, f.path as file, s.start_line, s.end_line
       FROM symbols s
       JOIN files f ON s.file_id = f.id
       WHERE s.name = ? AND s.kind != 'module'`
    )
    .all(name) as ResolvedSymbol[];
}

// ── History queries (Day 5, extended Day 7) ─────────────────────────

/**
 * Looks up commit history for a specific file and line.
 * Includes linked PR/issue data when available.
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
    .all(filePath, line, line) as Omit<HistoryEntry, "prNumbers" | "prTitles">[];

  return enrichWithPrData(db, rows);
}

/**
 * Looks up commit history for a function/symbol by name.
 * Includes linked PR/issue data when available.
 */
export function queryHistoryForFunction(
  db: Database.Database,
  functionName: string
): HistoryEntry[] {
  const symbol = db
    .prepare(
      `SELECT s.file_id, s.start_line, s.end_line
       FROM symbols s
       WHERE s.name = ? AND s.kind != 'module'
       LIMIT 1`
    )
    .get(functionName) as
    | { file_id: number; start_line: number; end_line: number }
    | undefined;

  if (!symbol) return [];

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
    .all(symbol.file_id, symbol.end_line, symbol.start_line) as Omit<HistoryEntry, "prNumbers" | "prTitles">[];

  return enrichWithPrData(db, rows);
}

/**
 * Enriches commit history rows with linked PR/issue data.
 */
function enrichWithPrData(
  db: Database.Database,
  rows: Omit<HistoryEntry, "prNumbers" | "prTitles">[]
): HistoryEntry[] {
  if (rows.length === 0) return [];

  // Batch-query PR links for all commits in one query
  const shas = rows.map((r) => r.commitSha);
  const placeholders = shas.map(() => "?").join(",");
  const prLinks = db
    .prepare(
      `SELECT commit_sha, pr_number, title
       FROM pr_issue_links
       WHERE commit_sha IN (${placeholders})`
    )
    .all(...shas) as { commit_sha: string; pr_number: number | null; title: string | null }[];

  // Group PR data by commit SHA
  const prBySha = new Map<string, { prNumbers: number[]; prTitles: string[] }>();
  for (const link of prLinks) {
    let entry = prBySha.get(link.commit_sha);
    if (!entry) {
      entry = { prNumbers: [], prTitles: [] };
      prBySha.set(link.commit_sha, entry);
    }
    if (link.pr_number != null) {
      entry.prNumbers.push(link.pr_number);
    }
    if (link.title != null) {
      entry.prTitles.push(link.title);
    }
  }

  // Merge PR data into history entries
  return rows.map((row) => {
    const prData = prBySha.get(row.commitSha);
    return {
      ...row,
      prNumbers: prData?.prNumbers ?? [],
      prTitles: prData?.prTitles ?? [],
    };
  });
}

// ── Impact queries (Day 6) ──────────────────────────────────────────

/**
 * BFS traversal of reverse edges to find all dependents of a symbol.
 *
 * Follows `calls` edges in reverse — who calls this symbol? Then who
 * calls those callers? De-duplicates to avoid cycles.
 *
 * @param db         - Open SQLite database
 * @param symbolId   - ID of the target symbol
 * @param maxDepth   - Maximum traversal depth (default: unlimited)
 * @returns Array of dependents with depth info, ordered by depth then file
 */
export function queryDependents(
  db: Database.Database,
  symbolId: number,
  maxDepth: number = Infinity
): Dependent[] {
  const results: Dependent[] = [];
  const visited = new Set<number>();
  const queue: { id: number; depth: number }[] = [{ id: symbolId, depth: 0 }];

  // Don't include the target itself in results
  visited.add(symbolId);

  const findParents = db.prepare(
    `SELECT DISTINCT s.id, s.name as symbol, f.path as file
     FROM edges e
     JOIN symbols s ON e.from_symbol_id = s.id
     JOIN files f ON s.file_id = f.id
     WHERE e.to_symbol_id = ? AND e.edge_type = 'calls'`
  );

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth > 0) {
      // We already looked up the parent info when enqueuing
    }

    if (current.depth >= maxDepth) continue;

    const parents = findParents.all(current.id) as {
      id: number;
      symbol: string;
      file: string;
    }[];

    for (const parent of parents) {
      if (visited.has(parent.id)) continue;
      visited.add(parent.id);

      results.push({
        file: parent.file,
        symbol: parent.symbol,
        depth: current.depth + 1,
      });

      queue.push({ id: parent.id, depth: current.depth + 1 });
    }
  }

  // Sort by depth, then by file, then by symbol
  results.sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol));

  return results;
}
