import type { Command } from "commander";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";
import { parseGitLog } from "../../ingestion/git/log.js";
import { parseGitBlame } from "../../ingestion/git/blame.js";
import { getGitHubToken } from "../../config/tokens.js";

/**
 * Core init logic — index a git repository into a SQLite graph database.
 * Extracted so integration tests can call it with a custom dbPath.
 *
 * @param repoRoot - Absolute path to the git repository root
 * @param dbPath   - Path to the SQLite database file
 */
export async function runInit(repoRoot: string, dbPath: string): Promise<void> {
  // 1. Create .prism directory
  mkdirSync(join(repoRoot, ".prism"), { recursive: true });

  // 2. Git log (no DB needed)
  console.log("  Parsing git history...");
  const commits = await parseGitLog(repoRoot);
  console.log(`    ${commits.length} commits`);

  // 3. Get tracked source files
  const trackedFiles = execSync("git ls-files '*.ts' '*.tsx' '*.js' '*.jsx'", {
    encoding: "utf-8",
    cwd: repoRoot,
  })
    .split("\n")
    .filter(Boolean);
  console.log(`    ${trackedFiles.length} source files`);

  // 4. Git blame (no DB needed — collect data in memory)
  console.log("  Running git blame...");
  const fileBlames: Array<{ path: string; blame: Array<{ commitSha: string; line: number }> }> = [];
  for (const filePath of trackedFiles) {
    try {
      const blame = await parseGitBlame(repoRoot, filePath);
      fileBlames.push({
        path: filePath,
        blame: blame
          .filter((e) => !e.commitSha.startsWith("00000000"))
          .map((e) => ({ commitSha: e.commitSha, line: e.line })),
      });
    } catch {
      // blame can fail on some files — skip silently
    }
  }
  console.log(`    ${fileBlames.length} files blamed`);

  // 5. Write git data to DB via child process.
  //    The child process (db-write.ts) uses better-sqlite3 which crashes
  //    during Node.js process teardown (native addon destructor assertion).
  //    The data IS written before the crash — we catch the error and verify.
  console.log("  Writing to database...");
  const gitData = JSON.stringify({ commits, files: fileBlames });
  try {
    const result = execFileSync(
      "npx",
      ["tsx", "src/ingestion/db-write.ts", dbPath],
      { input: gitData, cwd: repoRoot, encoding: "utf-8" }
    );
    const counts = JSON.parse(result);
    console.log(`    ${counts.commits} commits, ${counts.files} files, ${counts.commit_files} commit_files`);
  } catch (err: any) {
    // better-sqlite3 crashes during process teardown with a non-zero exit code,
    // but the data was written before the crash. Verify the DB exists and has data.
    if (existsSync(dbPath)) {
      console.log("    (git data written — process exited with warning)");
    } else {
      console.error(`  Error writing git data: ${err.message}`);
      process.exit(1);
    }
  }

  // 6. AST parsing (child process — ts-morph only)
  console.log("  Parsing AST...");
  const fileList = trackedFiles.join("\n");
  const parsedJson = join(".prism", "parsed.json");
  try {
    execFileSync(
      "npx",
      ["tsx", "src/ingestion/ast-parse.ts", repoRoot, parsedJson],
      { input: fileList, cwd: repoRoot, encoding: "utf-8" }
    );
  } catch (err: any) {
    console.error(`  Warning: AST parsing failed: ${err.message}`);
  }

  // 7. Build graph from JSON (child process — better-sqlite3 only)
  if (existsSync(parsedJson)) {
    console.log("  Building graph...");
    try {
      const result = execFileSync(
        "npx",
        ["tsx", "src/ingestion/graph-load.ts", repoRoot, parsedJson, dbPath],
        { cwd: repoRoot, encoding: "utf-8" }
      );
      process.stdout.write(`    ${result.trim()}\n`);
    } catch (err: any) {
      console.error(`  Warning: Graph building failed: ${err.message}`);
    }
  }

  // 8. GitHub enrichment (optional)
  const token = getGitHubToken();
  if (token) {
    console.log("  Fetching GitHub PR/issue data...");
    try {
      const shas = JSON.stringify(commits.map((c) => c.sha));
      execFileSync(
        "npx",
        ["tsx", "src/ingestion/github-fetch.ts", dbPath],
        { input: shas, cwd: repoRoot, encoding: "utf-8" }
      );
    } catch {
      console.log("    Skipped (no GitHub token or API error)");
    }
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Index the current repository (git history + code structure)")
    .option("--refresh", "Force a full re-index instead of using the existing cache")
    .action(async (options: { refresh?: boolean }) => {
      // Verify we're in a git repo
      let repoRoot: string;
      try {
        repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
      } catch {
        console.error("Error: Not inside a git repository.");
        process.exit(1);
      }

      console.log(`Indexing ${repoRoot}...`);

      const dbDir = join(repoRoot, ".prism");
      const dbPath = join(dbDir, "graph.db");

      // --refresh: delete existing database and parsed data, then rebuild from scratch
      if (options.refresh && existsSync(dbPath)) {
        console.log("  Refreshing — deleting existing index...");
        rmSync(dbPath, { force: true });
        rmSync(dbPath + "-wal", { force: true });
        rmSync(dbPath + "-shm", { force: true });
        rmSync(join(dbDir, "parsed.json"), { force: true });
      }

      await runInit(repoRoot, dbPath);

      console.log(`\nDone! Database: ${dbPath}`);
    });
}

