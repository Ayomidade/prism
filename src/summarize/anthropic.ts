import type { HistoryEntry } from "../graph/query.js";
import type { SummaryResult, Summarizer } from "./types.js";
import { buildPrompt, buildTemplateHeader } from "./prompt.js";

const MAX_TOKENS = 1024;

export async function createAnthropicSummarizer(
  apiKey: string,
  model: string
): Promise<Summarizer> {
  let Anthropic: any;
  try {
    const mod = await import("@anthropic-ai/sdk");
    Anthropic = mod.default;
  } catch {
    throw new Error(
      "@anthropic-ai/sdk is not installed. Install it with: npm install @anthropic-ai/sdk"
    );
  }

  const client = new Anthropic({ apiKey });

  async function callModel(prompt: string): Promise<string> {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }

  return {
    async summarize(history: HistoryEntry[], target: string): Promise<SummaryResult> {
      if (history.length === 0) {
        return {
          text: `No history found for ${target}.\nThis code may be new or not yet indexed.`,
          confidence: "none",
        };
      }

      const templateHeader = buildTemplateHeader(history, target);
      try {
        const aiText = await callModel(buildPrompt(history, target));
        return { text: `${templateHeader}\n\nAI analysis:\n${aiText}`, confidence: "ai-inferred" };
      } catch (err: any) {
        return {
          text: `${templateHeader}\n\n(AI analysis unavailable: ${err.message})`,
          confidence: "documented",
        };
      }
    },

    async summarizeJson(history: HistoryEntry[], target: string) {
      if (history.length === 0) {
        return { target, confidence: "none", commitCount: 0, history: [] };
      }
      try {
        const aiText = await callModel(buildPrompt(history, target));
        return {
          target,
          confidence: "ai-inferred",
          commitCount: history.length,
          history,
          ...(aiText ? { aiSummary: aiText } : {}),
        };
      } catch {
        return { target, confidence: "documented", commitCount: history.length, history };
      }
    },
  };
}
