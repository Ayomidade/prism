#!/usr/bin/env node
// Loads pre-parsed AST data from JSON and builds the graph in SQLite.
// No ts-morph dependency — safe to run in the main process alongside
// better-sqlite3.
//
// Usage: npx tsx src/ingestion/graph-load.ts <repo-root> <parsed-json> <db-path>

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { openDatabase } from "../store/db.js";
import { insertFile, insertSymbol, insertEdge } from "../store/repository.js";

interface ParsedSym {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  calls: string[];
}

interface ParsedNamedImport {
  source: string;
  names: string[];
}

interface ParsedFileJson {
  path: string;
  lineCount: number;
  symbols: ParsedSym[];
  imports: string[];
  namedImports: ParsedNamedImport[];
  moduleCalls: string[];
}

const [repoRoot, jsonPath, dbPath] = process.argv.slice(2);
if (!repoRoot || !jsonPath || !dbPath) {
  process.stderr.write("Usage: graph-load.ts <repo-root> <parsed-json> <db-path>\n");
  process.exit(1);
}

const parsed: ParsedFileJson[] = JSON.parse(readFileSync(jsonPath, "utf-8"));
const db = openDatabase(dbPath);

// Full re-index: wipe symbols and edges
db.exec("DELETE FROM edges");
db.exec("DELETE FROM symbols");

// Pass 1: insert files + symbols
const moduleSymbolIds = new Map<string, number>();
const fileSymbolNames = new Map<string, Map<string, number>>();

for (const file of parsed) {
  const fileId = insertFile(db, file.path);
  const moduleSymId = insertSymbol(db, fileId, file.path, "module", 1, file.lineCount);
  moduleSymbolIds.set(file.path, moduleSymId);

  const symMap = new Map<string, number>();
  for (const sym of file.symbols) {
    const symId = insertSymbol(db, fileId, sym.name, sym.kind, sym.startLine, sym.endLine);
    symMap.set(sym.name, symId);
  }
  fileSymbolNames.set(file.path, symMap);
}

// Pass 2: build import-name-to-file map
const importNameToFile = new Map<string, string>();
for (const file of parsed) {
  for (const ni of file.namedImports) {
    const resolved = resolveImport(ni.source, file.path, repoRoot);
    if (!resolved) continue;
    for (const name of ni.names) {
      const existing = importNameToFile.get(name);
      if (existing !== undefined && existing !== resolved) {
        importNameToFile.set(name, ""); // ambiguous — same name from different files
      } else if (existing === undefined) {
        importNameToFile.set(name, resolved);
      }
      // else: same name, same resolution — keep it
    }
  }
}

// Pass 3: insert edges
for (const file of parsed) {
  const fromModuleId = moduleSymbolIds.get(file.path);
  if (!fromModuleId) continue;

  // Import edges
  for (const importPath of file.imports) {
    const resolved = resolveImport(importPath, file.path, repoRoot);
    if (!resolved) continue;
    const toModuleId = moduleSymbolIds.get(resolved);
    if (!toModuleId) continue;
    insertEdge(db, fromModuleId, toModuleId, "imports");
  }

  // Module-level call edges — top-level script code isn't inside any
  // named function, so it's attributed to the file's own module symbol.
  const localSymbols = fileSymbolNames.get(file.path);
  for (const calleeName of file.moduleCalls ?? []) {
    const toSymId = resolveCallTarget(calleeName, localSymbols ?? new Map(), importNameToFile, fileSymbolNames);
    if (toSymId) {
      insertEdge(db, fromModuleId, toSymId, "calls");
    }
  }

  // Call edges
  if (!localSymbols) continue;

  for (const sym of file.symbols) {
    const fromSymId = localSymbols.get(sym.name);
    if (!fromSymId) continue;

    for (const calleeName of sym.calls) {
      const toSymId = resolveCallTarget(calleeName, localSymbols, importNameToFile, fileSymbolNames);
      if (toSymId) {
        insertEdge(db, fromSymId, toSymId, "calls");
      }
    }
  }
}

const symCount = (db.prepare("SELECT COUNT(*) as c FROM symbols").get() as any).c;
const edgeCount = (db.prepare("SELECT COUNT(*) as c FROM edges").get() as any).c;
process.stderr.write(`Graph loaded: ${parsed.length} files, ${symCount} symbols, ${edgeCount} edges\n`);
db.close();
// Force immediate exit to prevent better-sqlite3 destructor crash
// during Node.js process teardown (RemoveEnvironmentCleanupHook assertion).
process.exit(0);

// ── Helpers ──

function resolveCallTarget(
  calleeName: string,
  localSymbols: Map<string, number>,
  importNameToFile: Map<string, string>,
  fileSymbolNames: Map<string, Map<string, number>>
): number | null {
  const localId = localSymbols.get(calleeName);
  if (localId) return localId;

  const targetFile = importNameToFile.get(calleeName);
  if (targetFile && targetFile !== "") {
    const targetSymbols = fileSymbolNames.get(targetFile);
    if (targetSymbols) {
      const targetId = targetSymbols.get(calleeName);
      if (targetId) return targetId;
    }
  }

  return null;
}

function resolveImport(importSpecifier: string, fromFile: string, repoRoot: string): string | null {
  const fromDir = dirname(fromFile);
  const target = join(fromDir, importSpecifier);

  const candidates = [
    target,
    target.replace(/\.js$/, ".ts"),
    target.replace(/\.js$/, ".tsx"),
    target.replace(/\.jsx$/, ".tsx"),
    join(target, "index.ts"),
    join(target, "index.tsx"),
    join(target, "index.js"),
  ];

  for (const candidate of candidates) {
    const absolute = resolve(repoRoot, candidate);
    if (existsSync(absolute)) {
      return candidate;
    }
  }

  return null;
}
