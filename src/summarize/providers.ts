import { getProviderKey, getModel, getActiveProvider } from "../config/tokens.js";
import { fetchAvailableModels as fetchOpenAiCompatibleModels } from "./openai-compatible.js";
import { fetchAvailableModels as fetchAnthropicModels } from "./anthropic.js";

// Known providers speak one of two wire formats: Anthropic's native
// Messages API, or the OpenAI-compatible /chat/completions shape that
// OpenAI, Gemini, Groq, and most hosted-model gateways (OpenRouter, etc.)
// all share. Adding a new OpenAI-compatible provider is just adding a row
// here — no new request/response handling code needed.

export type ProviderId = "anthropic" | "openai" | "gemini" | "groq" | "custom";

export interface ProviderDefinition {
  id: ProviderId;
  wireFormat: "anthropic" | "openai-compatible";
  baseUrl?: string; // undefined for anthropic (uses the SDK directly)
  defaultModel: string;
  authFormat: "bearer" | "x-goog-api-key";
}

// Default models are current as of this writing and deliberately
// overridable via PRISM_AI_MODEL — provider lineups change often, and
// this registry shouldn't need a code change every time a vendor ships
// a new default.
const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  anthropic: {
    id: "anthropic",
    wireFormat: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    authFormat: "bearer",
  },
  openai: {
    id: "openai",
    wireFormat: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    authFormat: "bearer",
  },
  gemini: {
    id: "gemini",
    wireFormat: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.6-flash",
    authFormat: "x-goog-api-key",
  },
  groq: {
    id: "groq",
    wireFormat: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    authFormat: "bearer",
  },
  custom: {
    id: "custom",
    wireFormat: "openai-compatible",
    defaultModel: "",
    authFormat: "bearer",
  },
};

// Checked in this order when PRISM_AI_PROVIDER isn't set explicitly —
// first provider with a configured key wins.
const AUTO_DETECT_ORDER: ProviderId[] = ["anthropic", "openai", "gemini", "groq", "custom"];

export interface ResolvedProviderConfig {
  provider: ProviderDefinition;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * Determines which AI provider (if any) is configured, and resolves its
 * final settings (key, model, base URL — each individually overridable).
 * Returns null if nothing is configured, meaning the caller should fall
 * back to the template summarizer.
 *
 * Throws if PRISM_AI_PROVIDER is set explicitly but that provider has no
 * key configured — an explicit request for a provider that isn't set up
 * should fail loudly, not silently fall back to a different one.
 */
export function resolveAiProviderConfig(): ResolvedProviderConfig | null {
  const explicitId = process.env.PRISM_AI_PROVIDER as ProviderId | undefined;

  if (explicitId) {
    if (!PROVIDERS[explicitId]) {
      throw new Error(
        `Unknown PRISM_AI_PROVIDER "${explicitId}". Expected one of: ${Object.keys(PROVIDERS).join(", ")}`
      );
    }
    const key = getProviderKey(explicitId);
    if (!key) {
      throw new Error(
        `PRISM_AI_PROVIDER is set to "${explicitId}" but no key is configured for it. ` +
          `Set PRISM_${explicitId.toUpperCase()}_KEY or store it with: prism config set-key ${explicitId} <key>`
      );
    }
    return buildConfig(explicitId, key);
  }

  // Check for a stored active provider preference (set by `prism config switch-provider`).
  const storedId = getActiveProvider() as ProviderId | undefined;
  if (storedId && PROVIDERS[storedId]) {
    const key = getProviderKey(storedId);
    if (key) {
      try {
        return buildConfig(storedId, key);
      } catch {
        // Stored provider is misconfigured — fall through to auto-detect.
      }
    }
  }

  for (const id of AUTO_DETECT_ORDER) {
    const key = getProviderKey(id);
    if (!key) continue;
    try {
      return buildConfig(id, key);
    } catch {
      // Misconfigured provider (e.g. custom with no base URL) shouldn't
      // block auto-detect from trying the next candidate.
      continue;
    }
  }

  return null;
}

function buildConfig(id: ProviderId, apiKey: string): ResolvedProviderConfig {
  const provider = PROVIDERS[id];
  const model = getModel(id) || provider.defaultModel;
  const baseUrl = id === "custom" ? process.env.PRISM_AI_BASE_URL : provider.baseUrl;

  if (id === "custom" && (!baseUrl || !model)) {
    throw new Error(
      "Custom AI provider requires both PRISM_AI_BASE_URL and PRISM_AI_MODEL to be set."
    );
  }

  return { provider, apiKey, model, baseUrl };
}

/**
 * Fetches live available models for any known provider, for interactive
 * selection. Throws if the provider doesn't support listing or the
 * request fails — callers should catch and fall back to manual entry.
 */
export async function fetchModelsForProvider(
  id: ProviderId,
  apiKey: string,
  baseUrl?: string
): Promise<string[]> {
  const provider = PROVIDERS[id];

  if (provider.wireFormat === "anthropic") {
    return fetchAnthropicModels(apiKey);
  }

  const url = id === "custom" ? baseUrl : provider.baseUrl;
  if (!url) {
    throw new Error(`No base URL available to list models for "${id}"`);
  }
  return fetchOpenAiCompatibleModels(url, apiKey, provider.authFormat);
}
