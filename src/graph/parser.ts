import { Project } from "ts-morph";

// AST-based parsing of JS/TS files to extract symbols (functions, classes,
// exports) and import/call relationships. See docs/technical-architecture.md
// Section 2 (Code graph engine) and docs/prism-v1-build-spec.md Section 4.

export interface ParsedSymbol {
  name: string;
  kind: "function" | "class" | "export" | "variable";
  startLine: number;
  endLine: number;
}

export interface ParsedFile {
  path: string;
  symbols: ParsedSymbol[];
  imports: string[];
}

export function parseSourceFile(_project: Project, _filePath: string): ParsedFile {
  // TODO: implement per docs/prism-v1-build-spec.md Section 7, step 4
  throw new Error("parseSourceFile: not implemented yet");
}
