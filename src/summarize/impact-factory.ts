import type { ImpactSummarizer } from "./impact-types.js";
import { resolveAiProviderConfig } from "./providers.js";
import { createAiAnthropicImpactSummarizer } from "./impact-ai.js";
import { createAiOpenAiImpactSummarizer } from "./impact-ai.js";
import { createTemplateImpactSummarizer } from "./impact-template.js";

// Factory that returns the right impact summarizer based on configured
// provider. Same pattern as ai.ts for the "why" summarizer.

/**
 * Returns the configured AI impact summarizer, or the template impact
 * summarizer if no provider is configured.
 */
export async function createAiImpactSummarizer(): Promise<ImpactSummarizer> {
  const config = resolveAiProviderConfig();
  if (!config) return createTemplateImpactSummarizer();

  if (config.provider.wireFormat === "anthropic") {
    return createAiAnthropicImpactSummarizer(config.apiKey, config.model, config.provider.id);
  }
  return createAiOpenAiImpactSummarizer(config);
}
