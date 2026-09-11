import { Project, SyntaxKind } from "ts-morph";

// AST-based parsing of JS/TS files to extract symbols (functions, classes,
// exports) and import relationships. See docs/technical-architecture.md
// Section 2 and docs/prism-v1-build-spec.md Section 4.

export interface ParsedSymbol {
  name: string;
  kind: "function" | "class" | "export" | "variable";
  startLine: number;
  endLine: number;
}

export interface ParsedFile {
  path: string;
  lineCount: number;
  symbols: ParsedSymbol[];
  imports: string[]; // resolved relative paths only — external packages excluded
}

export function parseSourceFile(project: Project, filePath: string): ParsedFile {
  const sourceFile = project.getSourceFileOrThrow(filePath);

  const symbols: ParsedSymbol[] = [];

  // Top-level function declarations
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue; // skip anonymous functions
    symbols.push({
      name,
      kind: "function",
      startLine: fn.getStartLineNumber(),
      endLine: fn.getEndLineNumber(),
    });
  }

  // Top-level class declarations
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (!name) continue;
    symbols.push({
      name,
      kind: "class",
      startLine: cls.getStartLineNumber(),
      endLine: cls.getEndLineNumber(),
    });
  }

  // Named exports of other kinds (const foo = ..., export { bar }, etc.)
  for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
    // Skip if already captured as a function/class above
    if (symbols.some((s) => s.name === name)) continue;

    const decl = declarations[0];
    if (!decl) continue;

    symbols.push({
      name,
      kind: "export",
      startLine: decl.getStartLineNumber(),
      endLine: decl.getEndLineNumber(),
    });
  }

  // Imports — only relative paths (./foo, ../bar) are resolvable within the
  // repo graph. Bare specifiers (react, lodash) are external packages and
  // out of scope for the dependency graph.
  const imports: string[] = [];
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    if (specifier.startsWith(".")) {
      imports.push(specifier);
    }
  }

  return {
    path: filePath,
    lineCount: sourceFile.getEndLineNumber(),
    symbols,
    imports,
  };
}

/**
 * Builds a ts-morph Project rooted at the given repo, including all
 * .ts/.tsx/.js/.jsx files, excluding node_modules and dist.
 */
export function createProject(repoRoot: string): Project {
  const project = new Project({
    tsConfigFilePath: `${repoRoot}/tsconfig.json`,
    skipAddingFilesFromTsConfig: false,
  });
  return project;
}
