import type { Command } from "commander";
import { openDatabase } from "../../store/db.js";
import { resolveSymbol, queryDependents, listSymbolsByName } from "../../graph/query.js";
import { existsSync } from "node:fs";
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
 *   src/graph/build-graph.ts
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
      lines.push(`${indent}${dep.symbol}`);
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
    .action(async (symbol: string, options: { json?: boolean }) => {
      const dbPath = ".prism/graph.db";
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

        if (options.json) {
          console.log(JSON.stringify({ target, dependents }, null, 2));
        } else {
          console.log(formatTree(target, dependents));
        }
      } finally {
        db.close();
      }
    });
}
