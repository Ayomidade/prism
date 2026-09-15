#!/usr/bin/env node
// Child process: fetches PR/issue data from GitHub for commit SHAs.
// Receives SHAs via stdin, writes pr_issue_links to SQLite.
// Optional — fails gracefully if no token or repo info is available.
//
// Usage: npx tsx src/ingestion/github-fetch.ts <db-path>

import { openDatabase } from "../store/db.js";
import { insertPrIssueLink } from "../store/repository.js";
import { getGitHubToken } from "../config/tokens.js";
import { createGitHubClient } from "./github/client.js";
import { linkCommitsToPrsAndIssues } from "./github/pr-issue-link.js";

const dbPath = process.argv[2];
if (!dbPath) {
  process.stderr.write("Usage: github-fetch.ts <db-path>\n");
  process.exit(1);
}

// Read commit SHAs from stdin (JSON array)
const input = await new Promise<string>((resolve) => {
  let data = "";
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => resolve(data));
});

const shas: string[] = JSON.parse(input);
if (shas.length === 0) {
  process.stdout.write("No commits to look up.\n");
  process.exit(0);
}

// Check for GitHub token
const token = getGitHubToken();
if (!token) {
  process.stdout.write("No GitHub token configured — skipping PR/issue enrichment.\n");
  process.exit(0);
}

const client = createGitHubClient(token);
if (!client) {
  process.stdout.write("Failed to create GitHub client — skipping.\n");
  process.exit(0);
}

// Fetch PR/issue links for the commit SHAs
let links;
try {
  links = await linkCommitsToPrsAndIssues(client, shas);
} catch (err: any) {
  const msg = err?.message ?? String(err);
  if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
    process.stdout.write("GitHub token is invalid or expired — skipping PR/issue enrichment.\n");
  } else if (msg.includes("403") || msg.toLowerCase().includes("forbidden")) {
    process.stdout.write("GitHub token lacks required permissions — skipping PR/issue enrichment.\n");
  } else {
    process.stdout.write(`GitHub API error — skipping PR/issue enrichment.\n`);
  }
  process.exit(0);
}

// Write results to SQLite
const db = openDatabase(dbPath);

for (const link of links) {
  insertPrIssueLink(
    db,
    link.commitSha,
    link.prNumber,
    link.issueNumber,
    link.title,
    link.body,
  );
}

// Don't call db.close() — better-sqlite3 crashes during Node.js
// process teardown. Data is flushed via WAL; process.exit forces exit.
process.exit(0);

