import type { HistoryEntry } from "../graph/query.js";

// Pluggable summarizer interface. The template summarizer is the required
// v1 default (confidence: "documented"). The AI summarizer is an opt-in
// fast-follow (confidence: "ai-inferred"). Both conform to this interface.

export interface SummaryResult {
  text: string;
  confidence: "documented" | "ai-inferred" | "none";
}

export interface Summarizer {
  summarize(history: HistoryEntry[], target: string): Promise<SummaryResult>;
  summarizeJson(
    history: HistoryEntry[],
    target: string
  ): Promise<{
    target: string;
    confidence: string;
    commitCount: number;
    history: HistoryEntry[];
    aiSummary?: string;
  }>;
}
