import { existsSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";

// AST-based parsing of JS/TS files to extract symbols (functions, classes,
// exports) and import relationships. See docs/technical-architecture.md
// Section 2 and docs/tracecode-v1-build-spec.md Section 4.

export interface ParsedSymbol {
  name: string;
  kind: "function" | "class" | "export" | "variable";
  startLine: number;
  endLine: number;
  /** Names of functions called within this symbol's body (simple identifiers only). */
  calls: string[];
  /** Function names passed as arguments (e.g. Express middleware: router.use(protect)). */
  callbackRefs: string[];
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
  moduleCallbackRefs: string[]; // callback refs in top-level code
}

export function parseSourceFile(
  project: Project,
  filePath: string,
): ParsedFile {
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
      callbackRefs: collectCallbackRefs(fn),
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
      callbackRefs: collectCallbackRefs(cls),
    });
  }

  // Named exports of other kinds (const foo = ..., export { bar }, etc.)
  for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
    // Skip if already captured as a function/class above
    if (symbols.some((s) => s.name === name)) continue;
    // "default" is handled separately via export assignments (Gap 1 fix)
    if (name === "default") continue;

    const decl = declarations[0];
    if (!decl) continue;

    symbols.push({
      name,
      kind: "export",
      startLine: decl.getStartLineNumber(),
      endLine: decl.getEndLineNumber(),
      calls: [],
      callbackRefs: [],
    });
  }

  // Top-level const/let variable declarations — captures arrow functions,
  // function expressions, and other bindings that aren't function/class
  // declarations. Needed because const Marquee = () => {} is invisible
  // to getFunctions() and getExportedDeclarations() (when not named-exported).
  for (const varStatement of sourceFile.getVariableStatements()) {
    for (const varDecl of varStatement.getDeclarations()) {
      const name = varDecl.getName();
      if (!name) continue;
      if (symbols.some((s) => s.name === name)) continue;

      const initializer = varDecl.getInitializer();
      if (!initializer) continue;

      symbols.push({
        name,
        kind: "export",
        startLine: varDecl.getStartLineNumber(),
        endLine: varDecl.getEndLineNumber(),
        calls: collectCalls(initializer),
        callbackRefs: collectCallbackRefs(initializer),
      });
    }
  }

  // Default exports of existing identifiers — handles the React pattern:
  //   const Marquee = () => { ... };
  //   export default Marquee;
  // getExportedDeclarations() returns key "default" (not "Marquee"), so
  // the symbol was never created. Walk export assignments to find these.
  for (const exportAssign of sourceFile.getExportAssignments()) {
    const expression = exportAssign.getExpression();
    if (expression.getKind() !== SyntaxKind.Identifier) continue;

    const name = expression.getText();
    if (symbols.some((s) => s.name === name)) continue;

    // The variable declaration was already captured above if it's a
    // top-level const. If not (e.g. imported re-export), use the
    // export assignment's line range with empty calls.
    symbols.push({
      name,
      kind: "export",
      startLine: exportAssign.getStartLineNumber(),
      endLine: exportAssign.getEndLineNumber(),
      calls: [],
      callbackRefs: [],
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
    if (importDecl.isTypeOnly()) continue;

    const names: string[] = importDecl
      .getNamedImports()
      .map((n) => n.getName());

    // Default imports resolve the same way — needed for JSX, since
    // React components are almost always default-imported.
    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport) {
      names.push(defaultImport.getText());
    }

    if (names.length > 0) {
      namedImports.push({ source: specifier, names });
    }
  }

  // CommonJS require() — additive to ES imports above.
  const requireImports = collectRequireImports(sourceFile);
  imports.push(...requireImports.imports);
  namedImports.push(...requireImports.namedImports);

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
  const moduleCallbackRefs: string[] = [];
  for (const statement of sourceFile.getStatements()) {
    if (capturedKinds.has(statement.getKind())) continue;
    moduleCalls.push(...collectCalls(statement));
    moduleCallbackRefs.push(...collectCallbackRefs(statement));
  }

  return {
    path: filePath,
    lineCount: sourceFile.getEndLineNumber(),
    symbols,
    imports,
    namedImports,
    moduleCalls,
    moduleCallbackRefs,
  };
}

/**
 * Collects simple call-expression names from a function/class body.
 *
 * Captures direct identifier calls: `foo()` → "foo".
 * Captures JSX component references: `<Foo />` → "Foo".
 * Skips require() calls (tracked as imports, not calls).
 * Skips method calls (obj.method()), calls through
 * destructuring, and any other non-simple callees — these need
 * type-checker-backed resolution to do correctly, which is out of
 * scope for v1.
 */
function collectCalls(node: {
  forEachDescendant: (cb: (child: any) => void) => void;
}): string[] {
  const calls: string[] = [];
  node.forEachDescendant((child: any) => {
    if (child.getKind() === SyntaxKind.CallExpression) {
      const expr = child.asKindOrThrow(SyntaxKind.CallExpression);
      const callee = expr.getExpression();
      // Only capture simple identifier calls: foo(...)
      // Skip require() — it's tracked as an import, not a call.
      if (callee.getKind() === SyntaxKind.Identifier) {
        const name = callee.getText();
        if (name !== "require") {
          calls.push(name);
        }
      }
    }

    // JSX component references: <Foo /> or <Foo>...</Foo>
    // Capitalized tag names indicate components, not HTML elements.
    if (
      child.getKind() === SyntaxKind.JsxSelfClosingElement ||
      child.getKind() === SyntaxKind.JsxOpeningElement
    ) {
      const tagName = child.getTagNameNode?.()?.getText?.();
      if (tagName && /^[A-Z]/.test(tagName)) {
        calls.push(tagName);
      }
    }
  });
  return calls;
}

/**
 * Collects function names passed as arguments to any call expression.
 *
 * This captures the Express middleware pattern where functions are passed
 * as references rather than called directly:
 *   router.use(protect)          → "protect"
 *   router.post("/", validate, createHandler) → "validate", "createHandler"
 *
 * Skips string/number literals, arrow functions, and nested call expressions.
 * Nested call expressions (e.g. authorize("admin")) are already captured by
 * collectCalls as callee-position calls.
 */
function collectCallbackRefs(node: {
  forEachDescendant: (cb: (child: any) => void) => void;
}): string[] {
  const refs: string[] = [];
  node.forEachDescendant((child: any) => {
    if (child.getKind() === SyntaxKind.CallExpression) {
      const expr = child.asKindOrThrow(SyntaxKind.CallExpression);
      for (const arg of expr.getArguments()) {
        if (arg.getKind() === SyntaxKind.Identifier) {
          refs.push(arg.getText());
        }
      }
    }
  });
  return refs;
}

/**
 * Detects CommonJS require() calls with relative specifiers.
 *
 * Handles:
 *   const foo = require('./foo')
 *   require('../bar')
 *   const { a, b } = require('./baz')
 *
 * Returns imports (relative paths) and namedImports (for call resolution).
 * Skips non-relative requires (external packages like 'express', 'lodash').
 */
function collectRequireImports(sourceFile: any): {
  imports: string[];
  namedImports: NamedImport[];
} {
  const imports: string[] = [];
  const namedImports: NamedImport[] = [];

  sourceFile.forEachDescendant((child: any) => {
    if (child.getKind() !== SyntaxKind.CallExpression) return;

    const expr = child.asKindOrThrow(SyntaxKind.CallExpression);
    const callee = expr.getExpression();
    if (callee.getKind() !== SyntaxKind.Identifier) return;
    if (callee.getText() !== "require") return;

    const args = expr.getArguments();
    if (args.length === 0) return;

    const firstArg = args[0];
    if (firstArg.getKind() !== SyntaxKind.StringLiteral) return;

    const specifier = firstArg
      .asKindOrThrow(SyntaxKind.StringLiteral)
      .getLiteralValue();
    if (!specifier.startsWith(".")) return;

    imports.push(specifier);

    // Track destructured named imports: const { a, b } = require('./mod')
    const parent = child.getParent();
    if (parent && parent.getKind() === SyntaxKind.VariableDeclaration) {
      const varDecl = parent.asKindOrThrow(SyntaxKind.VariableDeclaration);
      const binding = varDecl.getNameNode();
      if (binding.getKind() === SyntaxKind.ObjectBindingPattern) {
        const bindingPattern = binding.asKindOrThrow(
          SyntaxKind.ObjectBindingPattern,
        );
        const names = bindingPattern
          .getElements()
          .map((el: any) => el.getName());
        if (names.length > 0) {
          namedImports.push({ source: specifier, names });
        }
      }
    }
  });

  return { imports, namedImports };
}

/**
 * Builds a ts-morph Project rooted at the given repo, including all
 * .ts/.tsx/.js/.jsx files, excluding node_modules and dist.
 */
export function createProject(repoRoot: string): Project {
  const tsConfigPath = `${repoRoot}/tsconfig.json`;

  if (existsSync(tsConfigPath)) {
    return new Project({
      tsConfigFilePath: tsConfigPath,
      skipAddingFilesFromTsConfig: false,
    });
  }

  // No tsconfig — bare JS project. Create a minimal project with JS
  // parsing enabled and manually add source files.
  const project = new Project({
    compilerOptions: { allowJs: true, checkJs: false },
  });
  project.addSourceFilesAtPaths([
    `${repoRoot}/**/*.{ts,tsx,js,jsx}`,
    `!${repoRoot}/node_modules/**`,
    `!${repoRoot}/**/node_modules/**`,
  ]);
  return project;
}
