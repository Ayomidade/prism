#!/usr/bin/env node
// Child process: receives git data via stdin, writes to SQLite.
// Isolates better-sqlite3 from the main process to avoid native addon crash.

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

// Insert commits
for (const c of data.commits) {
  insertCommit(db, c.sha, c.author, c.date, c.message);
}

// Insert files + commit_files
for (const file of data.files) {
  const fileId = insertFile(db, file.path);
  for (const entry of file.blame) {
    if (entry.commitSha.startsWith("00000000")) continue;
    db.prepare(
      `INSERT OR IGNORE INTO commit_files (commit_sha, file_id, start_line, end_line)
       VALUES (?, ?, ?, ?)`
    ).run(entry.commitSha, fileId, entry.line, entry.line);
  }
}

const counts = {
  commits: (db.prepare("SELECT COUNT(*) as c FROM commits").get() as any).c,
  files: (db.prepare("SELECT COUNT(*) as c FROM files").get() as any).c,
  commit_files: (db.prepare("SELECT COUNT(*) as c FROM commit_files").get() as any).c,
};

process.stdout.write(JSON.stringify(counts));
db.close();
