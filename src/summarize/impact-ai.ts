import type { ResolvedProviderConfig } from "./providers.js";
import type { ImpactSummarizer } from "./impact-types.js";
import { buildImpactPrompt } from "./impact-prompt.js";
import { createTemplateImpactSummarizer } from "./impact-template.js";
import { parseApiError } from "./api-error.js";

const MAX_TOKENS = 1024;

// AI-powered impact summarizer for Anthropic's native Messages API.
// Uses the same dynamic import pattern as the "why" summarizer.

export async function createAiAnthropicImpactSummarizer(
  apiKey: string,
  model: string,
  providerName: string = "anthropic"
): Promise<ImpactSummarizer> {
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

  return buildImpactSummarizer(callModel, providerName, model);
}

// AI-powered impact summarizer for OpenAI-compatible providers (OpenAI,
// Gemini, Groq, custom). Plain fetch(), no SDK dependency.

export function createAiOpenAiImpactSummarizer(
  config: ResolvedProviderConfig
): ImpactSummarizer {
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
        `${config.provider.id} (${config.model}) API error ${response.status}: ${parseApiError(body)}`
      );
    }

    const data = (await response.json()) as any;
    return data.choices?.[0]?.message?.content ?? "";
  }

  return buildImpactSummarizer(callModel, config.provider.id, config.model);
}

// Shared builder that wires a callModel function into the ImpactSummarizer interface.

function buildImpactSummarizer(
  callModel: (prompt: string) => Promise<string>,
  providerName: string,
  model: string
): ImpactSummarizer {
  const template = createTemplateImpactSummarizer();

  return {
    async summarizeImpact(target, dependents) {
      if (dependents.length === 0) {
        return {
          text: `No dependents found for ${target}.\nThis symbol is a leaf — changing it won't break anything in the indexed graph.`,
          confidence: "none",
        };
      }

      try {
        const aiText = await callModel(buildImpactPrompt(target, dependents));
        const templateText = await template.summarizeImpact(target, dependents);
        return {
          text: `${templateText.text}\n\nAI Impact Analysis:\n${aiText}`,
          confidence: "ai-inferred",
        };
      } catch (err: any) {
        const templateText = await template.summarizeImpact(target, dependents);
        return {
          text: `${templateText.text}\n\n(AI impact analysis unavailable: ${providerName} (${model}) — ${err.message})`,
          confidence: "documented",
        };
      }
    },

    async summarizeImpactJson(target, dependents) {
      const templateJson = await template.summarizeImpactJson(target, dependents);

      if (dependents.length === 0) {
        return { ...templateJson, confidence: "none" };
      }

      try {
        const aiText = await callModel(buildImpactPrompt(target, dependents));
        return { ...templateJson, confidence: "ai-inferred", aiSummary: aiText };
      } catch {
        return templateJson;
      }
    },
  };
}
