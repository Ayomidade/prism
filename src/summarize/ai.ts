import type { HistoryEntry } from "../graph/query.js";
import type { SummaryResult, Summarizer } from "./types.js";

// AI-powered summarizer using the Anthropic API. Opt-in — requires a
// user-provided API key (PRISM_ANTHROPIC_KEY env var or ~/.config/prism/anthropic-key).
// Falls back to the template summarizer if no key is configured.
//
// The AI receives commit history + PR context as structured input and
// produces a concise explanation of why the code exists. The output is
// tagged confidence: "ai-inferred" to distinguish from the template-based
// "documented" summaries.

const MODEL = "claude-sonnet-4-20250514";
const MAX_HISTORY_ENTRIES = 15;
const MAX_TOKENS = 1024;

/**
 * Creates an AI summarizer if an API key is available.
 * Returns null if no key is configured (caller should use template summarizer).
 *
 * Uses a dynamic import for @anthropic-ai/sdk so it doesn't fail
 * if the package isn't installed (optional peer dependency).
 */
export async function createAiSummarizer(apiKey: string): Promise<Summarizer> {
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

  return {
    async summarize(history: HistoryEntry[], target: string): Promise<SummaryResult> {
      if (history.length === 0) {
        return {
          text: `No history found for ${target}.\nThis code may be new or not yet indexed.`,
          confidence: "none",
        };
      }

      const prompt = buildPrompt(history, target);

      let aiText = "";
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: "user", content: prompt }],
        });
        aiText = response.content[0]?.type === "text" ? response.content[0].text : "";
      } catch (err: any) {
        // API error — fall back to template-only output
        const templateHeader = buildTemplateHeader(history, target);
        return {
          text: `${templateHeader}\n\n(AI analysis unavailable: ${err.message})`,
          confidence: "documented",
        };
      }

      const templateHeader = buildTemplateHeader(history, target);
      const text = `${templateHeader}\n\nAI analysis:\n${aiText}`;

      return { text, confidence: "ai-inferred" };
    },

    async summarizeJson(
      history: HistoryEntry[],
      target: string
    ): Promise<{
      target: string;
      confidence: string;
      commitCount: number;
      history: HistoryEntry[];
      aiSummary?: string;
    }> {
      if (history.length === 0) {
        return {
          target,
          confidence: "none",
          commitCount: 0,
          history: [],
        };
      }

      const prompt = buildPrompt(history, target);

      let aiText = "";
      let confidence = "ai-inferred";
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: "user", content: prompt }],
        });
        aiText = response.content[0]?.type === "text" ? response.content[0].text : "";
      } catch {
        // API error — return without AI summary
        confidence = "documented";
      }

      return {
        target,
        confidence,
        commitCount: history.length,
        history,
        ...(aiText ? { aiSummary: aiText } : {}),
      };
    },
  };
}

function buildPrompt(history: HistoryEntry[], target: string): string {
  const entries = history.slice(0, MAX_HISTORY_ENTRIES);

  const historyBlock = entries
    .map((e) => {
      const date = e.date.slice(0, 10);
      const sha = e.commitSha.slice(0, 7);
      const msg = e.message.split("\n")[0];
      const prs =
        e.prNumbers.length > 0
          ? ` (PRs: ${e.prNumbers.map((n) => `#${n}`).join(", ")})`
          : "";
      return `${date} ${sha} ${e.author}: ${msg}${prs}`;
    })
    .join("\n");

  return `You are analyzing why a specific piece of code exists in a codebase.

Target: ${target}

Commit history (most recent first):
${historyBlock}

Based on this commit history, provide a concise 2-3 sentence explanation of why this code exists. Focus on the purpose and intent, not just describing what the commits say. If there are PRs linked, mention them. Be specific and actionable.`;
}

function buildTemplateHeader(history: HistoryEntry[], target: string): string {
  const lines: string[] = [];
  lines.push(`Why does ${target} exist?`);
  lines.push("");

  const shown = history.slice(0, 5);
  for (const entry of shown) {
    const date = entry.date.slice(0, 10);
    const sha = entry.commitSha.slice(0, 7);
    const summary = entry.message.split("\n")[0];
    lines.push(`${date}  ${sha}  ${entry.author}`);
    lines.push(`  ${summary}`);
  }

  if (history.length > 5) {
    lines.push(`  ... and ${history.length - 5} more commits`);
  }

  return lines.join("\n");
}
