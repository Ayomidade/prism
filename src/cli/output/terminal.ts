// Human-readable terminal formatting for `why` and `impact` results.
// Use chalk for color, a simple tree renderer for `impact`'s dependent list.
// See docs/technical-architecture.md Section 1 (Frontend / CLI output).

export interface WhyResult {
  summary: string;
  confidence: "documented" | "ai-inferred";
  commits: Array<{ sha: string; message: string; date: string }>;
}

export interface ImpactResult {
  symbol: string;
  dependents: Array<{ file: string; symbol: string; depth: number }>;
}

export function formatWhyForTerminal(_result: WhyResult): string {
  // TODO: implement
  throw new Error("formatWhyForTerminal: not implemented yet");
}

export function formatImpactForTerminal(_result: ImpactResult): string {
  // TODO: implement
  throw new Error("formatImpactForTerminal: not implemented yet");
}
