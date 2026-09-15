import type { Summarizer } from "./types.js";
import { resolveAiProviderConfig } from "./providers.js";
import { createAnthropicSummarizer } from "./anthropic.js";
import { createOpenAiCompatibleSummarizer } from "./openai-compatible.js";
import { createTemplateSummarizer } from "./template.js";

// Factory that returns the right summarizer based on configured provider.
// This is the only function callers (why.ts) need — all provider
// selection/resolution happens here.

/**
 * Returns the configured AI summarizer, or the template summarizer if no
 * provider is configured. Provider selection:
 *
 *   1. PRISM_AI_PROVIDER env var picks explicitly
 *   2. If unset, auto-detects from configured keys in priority order
 *      (anthropic → openai → gemini → groq → custom)
 *   3. If none configured, falls back to the template summarizer
 */
export async function createAiSummarizer(): Promise<Summarizer> {
  const config = resolveAiProviderConfig();
  if (!config) return createTemplateSummarizer();

  if (config.provider.wireFormat === "anthropic") {
    return createAnthropicSummarizer(config.apiKey, config.model, config.provider.id);
  }
  return createOpenAiCompatibleSummarizer(config);
}
