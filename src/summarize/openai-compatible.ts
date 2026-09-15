import type { HistoryEntry } from "../graph/query.js";
import type { SummaryResult, Summarizer } from "./types.js";
import { buildPrompt, buildTemplateHeader } from "./prompt.js";
import type { ResolvedProviderConfig } from "./providers.js";

// Generic summarizer for any provider speaking the OpenAI-compatible
// /chat/completions wire format — OpenAI, Gemini, Groq, and a custom
// slot for anything else (OpenRouter, local models, etc.). Plain fetch(),
// no SDK dependency, since the request/response shape is simple and
// stable across all of these.

const MAX_TOKENS = 1024;

export function createOpenAiCompatibleSummarizer(config: ResolvedProviderConfig): Summarizer {
  const url = `${config.baseUrl}/chat/completions`;

  async function callModel(prompt: string): Promise<string> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `${config.provider.id} API error (${response.status}): ${body.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as any;
    return data.choices?.[0]?.message?.content ?? "";
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
        return {
          text: `${templateHeader}\n\nAI analysis:\n${aiText}`,
          confidence: "ai-inferred",
        };
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
        return {
          target,
          confidence: "documented",
          commitCount: history.length,
          history,
        };
      }
    },
  };
}
