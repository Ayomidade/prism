#!/usr/bin/env node
// Child process: receives git data via stdin, writes to SQLite.
// Isolates better-sqlite3 from the main process to avoid native addon crash.
//
// Commit_files are stored as line ranges: consecutive lines from the same
// commit are merged into a single row (start_line, end_line) instead of
// one row per line. This significantly reduces table size and query time.

import { openDatabase } from "../store/db.js";
import { insertCommit, insertFile } from "../store/repository.js";

const dbPath = process.argv[2];
if (!dbPath) {
  process.stderr.write("Usage: db-write.ts <db-path>\n");
  process.exit(1);
}

// Read JSON data from stdin
const input = await new Promise<string>((resolve) => {
  let data = "";
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => resolve(data));
});

const data = JSON.parse(input) as {
  commits: Array<{ sha: string; author: string; date: string; message: string }>;
  files: Array<{ path: string; blame: Array<{ commitSha: string; line: number }> }>;
};

const db = openDatabase(dbPath);

// Deduplicate existing per-line commit_files rows into ranges.
// This handles data from previous schema versions that stored one row per line.
const existingCount = (db.prepare("SELECT COUNT(*) as c FROM commit_files").get() as any).c;
if (existingCount > 0) {
  const rows = db
    .prepare("SELECT id, commit_sha, file_id, start_line FROM commit_files ORDER BY commit_sha, file_id, start_line")
    .all() as Array<{ id: number; commit_sha: string; file_id: number; start_line: number }>;

  if (rows.length > 0) {
    const grouped = new Map<string, { commit_sha: string; file_id: number; lines: number[] }>();
    for (const row of rows) {
      const key = `${row.commit_sha}:${row.file_id}`;
      let group = grouped.get(key);
      if (!group) {
        group = { commit_sha: row.commit_sha, file_id: row.file_id, lines: [] };
        grouped.set(key, group);
      }
      group.lines.push(row.start_line);
    }

    // Delete old per-line rows and insert merged ranges
    db.exec("DELETE FROM commit_files");
    const insert = db.prepare(
      "INSERT OR IGNORE INTO commit_files (commit_sha, file_id, start_line, end_line) VALUES (?, ?, ?, ?)"
    );
    const dedup = db.transaction(() => {
      for (const group of grouped.values()) {
        const ranges = mergeToRanges(group.lines);
        for (const range of ranges) {
          insert.run(group.commit_sha, group.file_id, range.start, range.end);
        }
      }
    });
    dedup();
  }
}

// Insert commits + files + commit_files in a single transaction for performance
const insertAll = db.transaction(() => {
  for (const c of data.commits) {
    insertCommit(db, c.sha, c.author, c.date, c.message);
  }

  // Insert files + commit_files (as line ranges)
  const cfInsert = db.prepare(
    "INSERT OR IGNORE INTO commit_files (commit_sha, file_id, start_line, end_line) VALUES (?, ?, ?, ?)"
  );

  for (const file of data.files) {
    const fileId = insertFile(db, file.path);

    // Group lines by commit SHA
    const byCommit = new Map<string, number[]>();
    for (const entry of file.blame) {
      if (entry.commitSha.startsWith("00000000")) continue;
      let lines = byCommit.get(entry.commitSha);
      if (!lines) {
        lines = [];
        byCommit.set(entry.commitSha, lines);
      }
      lines.push(entry.line);
    }

    // Insert one row per commit (as a line range) instead of one row per line
    for (const [commitSha, lines] of byCommit) {
      const ranges = mergeToRanges(lines);
      for (const range of ranges) {
        cfInsert.run(commitSha, fileId, range.start, range.end);
      }
    }
  }
});
insertAll();

const counts = {
  commits: (db.prepare("SELECT COUNT(*) as c FROM commits").get() as any).c,
  files: (db.prepare("SELECT COUNT(*) as c FROM files").get() as any).c,
  commit_files: (db.prepare("SELECT COUNT(*) as c FROM commit_files").get() as any).c,
};

process.stdout.write(JSON.stringify(counts));
db.close();
// Force immediate exit to prevent better-sqlite3 destructor crash
// during Node.js process teardown (RemoveEnvironmentCleanupHook assertion).
process.exit(0);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Merges an array of line numbers into contiguous ranges.
 * Example: [1, 2, 3, 5, 7, 8] → [{start: 1, end: 3}, {start: 5, end: 5}, {start: 7, end: 8}]
 */
function mergeToRanges(lines: number[]): Array<{ start: number; end: number }> {
  if (lines.length === 0) return [];

  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: Array<{ start: number; end: number }> = [];
  let current = { start: sorted[0], end: sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === current.end + 1) {
      current.end = sorted[i];
    } else {
      ranges.push(current);
      current = { start: sorted[i], end: sorted[i] };
    }
  }
  ranges.push(current);

  return ranges;
}
