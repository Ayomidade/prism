// Terminal formatting helpers for `why` and `impact` output.
//
// The CLI commands (why.ts, impact.ts) currently build terminal output
// directly via buildTemplateSummary() and formatTree(). These interfaces
// are defined here for future use when richer terminal formatting is needed
// (colors via chalk, structured tables, etc.).
//
// See docs/technical-architecture.md Section 1 (Frontend / CLI output).

export interface WhyResult {
  summary: string;
  confidence: "documented" | "ai-inferred" | "none";
  commits: Array<{ sha: string; message: string; date: string }>;
}

export interface ImpactResult {
  symbol: string;
  dependents: Array<{ file: string; symbol: string; depth: number }>;
}
