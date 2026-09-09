import type { HistoryEntry } from "../graph/query.js";

// Default, no-AI "why" summary builder. Assembles raw commit messages and
// PR/issue text into a readable summary tagged confidence: "documented".
// This is the required v1 default — see docs/mvp-contract.md.
//
// AI-assisted summarization (confidence: "ai-inferred") is an explicit
// fast-follow, not part of the v1 contract. Do not add an AI dependency here.

export function buildTemplateSummary(_history: HistoryEntry[]): string {
  // TODO: implement per docs/prism-v1-build-spec.md Section 5 (`prism why`)
  throw new Error("buildTemplateSummary: not implemented yet");
}
