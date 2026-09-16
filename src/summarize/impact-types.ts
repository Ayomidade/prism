import type { HistoryEntry } from "../graph/query.js";

// Types for the impact summarizer pipeline. Separate from the "why"
// summarizer (types.ts) because impact works with a fundamentally
// different data shape: dependency graphs (Dependent[]) vs commit
// history (HistoryEntry[]).

export interface EnrichedDependent {
  file: string;
  symbol: string;
  kind: string;
  depth: number;
  edgeType: string;
  symbolId: number;
  startLine: number;
  endLine: number;
  sourceSnippet: string | null;
  history: HistoryEntry[];
}

export interface ImpactSummaryResult {
  text: string;
  confidence: "documented" | "ai-inferred" | "none";
}

export interface ImpactSummarizer {
  summarizeImpact(
    target: string,
    dependents: EnrichedDependent[]
  ): Promise<ImpactSummaryResult>;

  summarizeImpactJson(
    target: string,
    dependents: EnrichedDependent[]
  ): Promise<{
    target: string;
    confidence: string;
    dependentCount: number;
    directCount: number;
    transitiveCount: number;
    aiSummary?: string;
  }>;
}
