import { getProviderKey } from "../config/tokens.js";

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
  },
  openai: {
    id: "openai",
    wireFormat: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  gemini: {
    id: "gemini",
    wireFormat: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
  },
  groq: {
    id: "groq",
    wireFormat: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  // Escape hatch for anything else speaking the OpenAI-compatible shape —
  // OpenRouter (which hosts many free-tier models), a local Ollama server,
  // or any future provider. No hardcoded assumptions about which one; the
  // user points it wherever they want via PRISM_AI_BASE_URL / PRISM_AI_MODEL.
  custom: {
    id: "custom",
    wireFormat: "openai-compatible",
    defaultModel: "", // must come from PRISM_AI_MODEL — no sensible default
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
  const model = process.env.PRISM_AI_MODEL || provider.defaultModel;
  const baseUrl = id === "custom" ? process.env.PRISM_AI_BASE_URL : provider.baseUrl;

  if (id === "custom" && (!baseUrl || !model)) {
    throw new Error(
      "Custom AI provider requires both PRISM_AI_BASE_URL and PRISM_AI_MODEL to be set."
    );
  }

  return { provider, apiKey, model, baseUrl };
}
