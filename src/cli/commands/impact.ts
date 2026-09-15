import type { Command } from "commander";
import { openDatabase, getDbPath } from "../../store/db.js";
import { resolveSymbol, queryDependents, listSymbolsByName } from "../../graph/query.js";
import { existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { generateImpactHtml } from "../output/html.js";
import type { Dependent } from "../../graph/query.js";

// Build spec: docs/prism-v1-build-spec.md Section 5 (`prism impact`)
//
// Responsibilities:
// - Resolve the symbol (disambiguate by file path if the name is ambiguous)
// - Traverse the reverse dependency graph (src/graph/query.ts)
// - Output a tree: direct dependents first, then transitive, grouped by file
// - --json returns a flat list with a `depth` field per dependent

/**
 * Formats dependents as a terminal-friendly tree, grouped by file.
 *
 * Output looks like:
 *   src/cli/index.ts
 *     registerCommands
 *   src/graph/query.ts
 *     buildGraph
 *       resolveImport
 */
function formatTree(target: string, dependents: Dependent[]): string {
  if (dependents.length === 0) {
    return `No dependents found for ${target}.`;
  }

  const lines: string[] = [];
  lines.push(`Impact of changing ${target}:`);
  lines.push("");

  // Group by file, preserving depth order within each file
  const byFile = new Map<string, Dependent[]>();
  for (const dep of dependents) {
    const existing = byFile.get(dep.file);
    if (existing) {
      existing.push(dep);
    } else {
      byFile.set(dep.file, [dep]);
    }
  }

  // Sort files alphabetically
  const sortedFiles = [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [file, deps] of sortedFiles) {
    lines.push(file);
    for (const dep of deps) {
      const indent = "  ".repeat(dep.depth);
      const label = dep.kind === "module" ? `${dep.symbol} (top-level code)` : dep.symbol;
      lines.push(`${indent}${label}`);
    }
  }

  lines.push("");
  lines.push(`${dependents.length} dependent${dependents.length === 1 ? "" : "s"} found.`);

  return lines.join("\n");
}

export function registerImpactCommand(program: Command): void {
  program
    .command("impact")
    .description("Show what could break if a symbol changes")
    .argument("<symbol>", "Symbol name, or file:symbol to disambiguate")
    .option("--json", "Output as JSON instead of a tree")
    .option("--html [path]", "Export as a standalone HTML report (default: impact-report.html)")
    .action(async (symbol: string, options: { json?: boolean; html?: string | boolean }) => {
      let repoRoot: string;
      try {
        repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
      } catch {
        console.error("Error: Not inside a git repository.");
        process.exit(1);
      }

      const dbPath = getDbPath(repoRoot);
      if (!existsSync(dbPath)) {
        console.error("Error: No indexed data found. Run `prism init` first.");
        process.exit(1);
      }

      const db = openDatabase(dbPath);

      try {
        const resolved = resolveSymbol(db, symbol);

        if (!resolved) {
          // Check if it's ambiguous (multiple matches) or not found at all
          const matches = listSymbolsByName(db, symbol);
          if (matches.length > 1) {
            console.error(`Error: "${symbol}" is ambiguous. Did you mean:`);
            for (const m of matches) {
              console.error(`  ${m.file}:${m.name} (${m.kind})`);
            }
          } else {
            console.error(`Error: Symbol "${symbol}" not found.`);
          }
          process.exit(1);
        }

        const target = `${resolved.file}:${resolved.name}`;
        const dependents = queryDependents(db, resolved.id);

        if (options.html) {
          // Determine output path
          const htmlPath = typeof options.html === "string" && options.html.length > 0
            ? options.html
            : "impact-report.html";

          // Get repo name from git remote if available
          let repoName: string | undefined;
          try {
            const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
            const match = remote.match(/[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
            if (match) repoName = `${match[1]}/${match[2]}`;
          } catch {
            // No remote configured — use directory name
          }

          const html = generateImpactHtml(target, dependents, {
            repoName,
            generatedAt: new Date().toISOString(),
          });
          writeFileSync(htmlPath, html, "utf-8");
          console.log(`HTML report written to ${htmlPath}`);
        } else if (options.json) {
          console.log(JSON.stringify({ target, dependents }, null, 2));
        } else {
          console.log(formatTree(target, dependents));
        }
      } finally {
        // Don't call db.close() — better-sqlite3 crashes during Node.js
        // process teardown. Data is flushed via WAL; GC handles cleanup.
      }
    });
}
