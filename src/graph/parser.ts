import { Project, SyntaxKind } from "ts-morph";

// AST-based parsing of JS/TS files to extract symbols (functions, classes,
// exports) and import relationships. See docs/technical-architecture.md
// Section 2 and docs/prism-v1-build-spec.md Section 4.

export interface ParsedSymbol {
  name: string;
  kind: "function" | "class" | "export" | "variable";
  startLine: number;
  endLine: number;
  /** Names of functions called within this symbol's body (simple identifiers only). */
  calls: string[];
}

/** A named import from a relative module — tracks which names come from where. */
export interface NamedImport {
  source: string; // relative import specifier, e.g. "./schema.js"
  names: string[]; // named identifiers, e.g. ["SCHEMA_SQL", "SCHEMA_VERSION"]
}

export interface ParsedFile {
  path: string;
  lineCount: number;
  symbols: ParsedSymbol[];
  imports: string[]; // resolved relative paths only — external packages excluded
  namedImports: NamedImport[]; // named imports with source tracking (for call resolution)
  moduleCalls: string[]; // calls made from top-level script code (not inside any named function/class)
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
      calls: collectCalls(fn),
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
      calls: collectCalls(cls),
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
      calls: [],
    });
  }

  // Imports — only relative paths (./foo, ../bar) are resolvable within the
  // repo graph. Bare specifiers (react, lodash) are external packages and
  // out of scope for the dependency graph.
  const imports: string[] = [];
  const namedImports: NamedImport[] = [];

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    if (!specifier.startsWith(".")) continue;

    imports.push(specifier);

    // Track named imports for call resolution.
    // Type-only imports are excluded — they don't exist at runtime.
    // Default-only and namespace-only imports are excluded — we can't
    // resolve individual names from them without type-checker info.
    if (importDecl.isTypeOnly()) continue;

    const namedNames = importDecl.getNamedImports().map((n) => n.getName());
    if (namedNames.length > 0) {
      namedImports.push({ source: specifier, names: namedNames });
    }
  }

  // Top-level statements — anything not already captured as a function,
  // class, or import/export declaration. Subprocess entry-point scripts
  // (graph-load.ts, db-write.ts, etc.) run as top-level code, so calls
  // here would otherwise be invisible to the call graph.
  const capturedKinds = new Set([
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.ClassDeclaration,
    SyntaxKind.ExportDeclaration,
    SyntaxKind.ImportDeclaration,
  ]);

  const moduleCalls: string[] = [];
  for (const statement of sourceFile.getStatements()) {
    if (capturedKinds.has(statement.getKind())) continue;
    moduleCalls.push(...collectCalls(statement));
  }

  return {
    path: filePath,
    lineCount: sourceFile.getEndLineNumber(),
    symbols,
    imports,
    namedImports,
    moduleCalls,
  };
}

/**
 * Collects simple call-expression names from a function/class body.
 *
 * Only captures direct identifier calls: `foo()` → "foo".
 * Skips method calls (obj.method()), calls through
 * destructuring, and any other non-simple callees — these need
 * type-checker-backed resolution to do correctly, which is out of
 * scope for v1.
 */
function collectCalls(node: { forEachDescendant: (cb: (child: any) => void) => void }): string[] {
  const calls: string[] = [];
  node.forEachDescendant((child: any) => {
    if (child.getKind() === SyntaxKind.CallExpression) {
      const expr = child.asKindOrThrow(SyntaxKind.CallExpression);
      const callee = expr.getExpression();
      // Only capture simple identifier calls: foo(...)
      if (callee.getKind() === SyntaxKind.Identifier) {
        calls.push(callee.getText());
      }
    }
  });
  return calls;
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
