import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dependent } from "../graph/query.js";
import { queryHistoryForSymbolId } from "../graph/query.js";
import type { EnrichedDependent } from "./impact-types.js";

const MAX_SNIPPET_LINES = 30;

/**
 * Reads a function body from disk given its file path and line range.
 * Returns the source snippet, or null if the file is unavailable.
 */
function readSourceSnippet(repoRoot: string, file: string, startLine: number, endLine: number): string | null {
  try {
    const content = readFileSync(join(repoRoot, file), "utf-8");
    const lines = content.split("\n");
    const snippet = lines.slice(startLine - 1, Math.min(endLine, startLine + MAX_SNIPPET_LINES - 1)).join("\n");
    if (endLine - startLine + 1 > MAX_SNIPPET_LINES) {
      return snippet + "\n... (truncated)";
    }
    return snippet;
  } catch {
    return null;
  }
}

/**
 * Enriches dependents with source code snippets and commit history.
 *
 * - All dependents get source snippets (truncated to 30 lines)
 * - Direct dependents (depth 1) get commit history (up to 5 commits)
 * - Transitive dependents (depth 2+) skip history (expensive, low value)
 */
export function enrichDependents(
  db: Database.Database,
  dependents: Dependent[],
  repoRoot: string
): EnrichedDependent[] {
  return dependents.map((dep) => {
    const sourceSnippet = readSourceSnippet(repoRoot, dep.file, dep.startLine, dep.endLine);
    const history = dep.depth === 1
      ? queryHistoryForSymbolId(db, dep.symbolId, 5)
      : [];

    return {
      file: dep.file,
      symbol: dep.symbol,
      kind: dep.kind,
      depth: dep.depth,
      edgeType: dep.edgeType,
      symbolId: dep.symbolId,
      startLine: dep.startLine,
      endLine: dep.endLine,
      sourceSnippet,
      history,
    };
  });
}
