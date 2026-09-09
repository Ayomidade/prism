import type { ParsedFile } from "./parser.js";
import type { ParsedCommit } from "../ingestion/git/log.js";
import type { BlameLine } from "../ingestion/git/blame.js";

// Constructs the full node/edge graph from parsed AST data + git blame data,
// ready to be persisted via src/store/repository.ts.
// See docs/prism-v1-build-spec.md Section 4 (Graph Model) and Section 7
// (Indexing Pipeline, steps 4-6).

export interface GraphBuildInput {
  files: ParsedFile[];
  commits: ParsedCommit[];
  blameByFile: Map<string, BlameLine[]>;
}

export function buildGraph(_input: GraphBuildInput): void {
  // TODO: cross-reference blame data with symbol line ranges (commit_files)
  // TODO: parse import/call statements into edges
  throw new Error("buildGraph: not implemented yet");
}
