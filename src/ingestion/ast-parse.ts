#!/usr/bin/env node
// Child process script that parses AST and writes results to JSON.
// Separated from init.ts to avoid the ts-morph + better-sqlite3
// native addon conflict (both register C++ cleanup hooks that crash
// during process teardown when loaded in the same process).
//
// Usage: npx tsx src/ingestion/ast-parse.ts <repo-root> <output-json>

import { writeFileSync } from "node:fs";
import { createProject, parseSourceFile } from "../graph/parser.js";

const [repoRoot, outputPath] = process.argv.slice(2);
if (!repoRoot || !outputPath) {
  process.stderr.write("Usage: ast-parse.ts <repo-root> <output-json>\n");
  process.exit(1);
}

const project = createProject(repoRoot);

// Read file list from stdin (one path per line)
const input = await new Promise<string>((resolve) => {
  let data = "";
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => resolve(data));
});

const files = input.split("\n").filter(Boolean);
const parsed = files
  .filter((f) => project.getSourceFile(f) !== undefined)
  .map((f) => parseSourceFile(project, f));

writeFileSync(outputPath, JSON.stringify(parsed));
process.stdout.write(`parsed ${parsed.length} files\n`);
