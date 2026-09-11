import type { Command } from "commander";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";
import { parseGitLog } from "../../ingestion/git/log.js";
import { parseGitBlame } from "../../ingestion/git/blame.js";
import { getGitHubToken } from "../../config/tokens.js";

// Build spec: docs/prism-v1-build-spec.md Section 5 (`prism init`) + Section 7 (indexing pipeline)
//
// Architecture: the main process never imports better-sqlite3. All DB writes
// happen in child processes (db-write.ts, graph-load.ts) to avoid the native
// addon crash (ts-morph + better-sqlite3 both register C++ cleanup hooks that
// conflict during Node.js process teardown).

const DB_DIR = ".prism";
const DB_PATH = join(DB_DIR, "graph.db");

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Index the current repository (git history + code structure)")
    .option("--refresh", "Force a full re-index instead of using the existing cache")
    .action(async (_options: { refresh?: boolean }) => {
      // 1. Verify we're in a git repo
      let repoRoot: string;
      try {
        repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
      } catch {
        console.error("Error: Not inside a git repository.");
        process.exit(1);
      }

      console.log(`Indexing ${repoRoot}...`);

      // 2. Create .prism directory
      mkdirSync(DB_DIR, { recursive: true });

      // 3. Git log (no DB needed)
      console.log("  Parsing git history...");
      const commits = await parseGitLog(repoRoot);
      console.log(`    ${commits.length} commits`);

      // 4. Get tracked source files
      const trackedFiles = execSync("git ls-files '*.ts' '*.tsx' '*.js' '*.jsx'", {
        encoding: "utf-8",
        cwd: repoRoot,
      })
        .split("\n")
        .filter(Boolean);
      console.log(`    ${trackedFiles.length} source files`);

      // 5. Git blame (no DB needed — collect data in memory)
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

      // 6. Write git data to DB via child process
      console.log("  Writing to database...");
      const gitData = JSON.stringify({ commits, files: fileBlames });
      try {
        const result = execFileSync(
          "npx",
          ["tsx", "src/ingestion/db-write.ts", DB_PATH],
          { input: gitData, cwd: repoRoot, encoding: "utf-8" }
        );
        const counts = JSON.parse(result);
        console.log(`    ${counts.commits} commits, ${counts.files} files, ${counts.commit_files} commit_files`);
      } catch (err: any) {
        console.error(`  Error writing git data: ${err.message}`);
        process.exit(1);
      }

      // 7. AST parsing (child process — ts-morph only)
      console.log("  Parsing AST...");
      const fileList = trackedFiles.join("\n");
      const parsedJson = join(DB_DIR, "parsed.json");
      try {
        execFileSync(
          "npx",
          ["tsx", "src/ingestion/ast-parse.ts", repoRoot, parsedJson],
          { input: fileList, cwd: repoRoot, encoding: "utf-8" }
        );
      } catch (err: any) {
        console.error(`  Warning: AST parsing failed: ${err.message}`);
      }

      // 8. Build graph from JSON (child process — better-sqlite3 only)
      if (existsSync(parsedJson)) {
        console.log("  Building graph...");
        try {
          const result = execFileSync(
            "npx",
            ["tsx", "src/ingestion/graph-load.ts", repoRoot, parsedJson, DB_PATH],
            { cwd: repoRoot, encoding: "utf-8" }
          );
          process.stdout.write(`    ${result.trim()}\n`);
        } catch (err: any) {
          console.error(`  Warning: Graph building failed: ${err.message}`);
        }
      }

      // 9. GitHub enrichment (optional)
      const token = getGitHubToken();
      if (token) {
        console.log("  Fetching GitHub PR/issue data...");
        try {
          // GitHub enrichment runs in a child process too
          const shas = JSON.stringify(commits.map((c) => c.sha));
          execFileSync(
            "npx",
            ["tsx", "src/ingestion/github-fetch.ts", DB_PATH],
            { input: shas, cwd: repoRoot, encoding: "utf-8" }
          );
        } catch {
          console.log("    Skipped (no GitHub token or API error)");
        }
      }

      console.log(`\nDone! Database: ${DB_PATH}`);
    });
}
