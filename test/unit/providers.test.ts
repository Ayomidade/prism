import { describe, it, expect, afterEach, vi } from "vitest";

// Mock tokens.ts so tests only read from env vars, never from real files.
// This prevents tests from being affected by (or corrupting) a developer's
// actual ~/.config/tracecode/ configuration.
vi.mock("../../src/config/tokens.js", () => ({
  getProviderKey: (id: string) =>
    process.env[`TRACECODE_${id.toUpperCase()}_KEY`],
  getModel: (id: string) => process.env.TRACECODE_AI_MODEL,
  getActiveProvider: () => undefined,
}));

const { resolveAiProviderConfig } =
  await import("../../src/summarize/providers.js");

// Tests for provider resolution logic — the branching logic that
// determines which AI provider (if any) is used. This is the most
// important part to lock down since it has real edge cases:
// explicit provider with no key should throw, auto-detect should
// pick the first configured key, custom needs both base URL and model.

describe("resolveAiProviderConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when no provider is configured", () => {
    delete process.env.TRACECODE_AI_PROVIDER;
    delete process.env.TRACECODE_ANTHROPIC_KEY;
    delete process.env.TRACECODE_OPENAI_KEY;
    delete process.env.TRACECODE_GEMINI_KEY;
    delete process.env.TRACECODE_GROQ_KEY;
    delete process.env.TRACECODE_CUSTOM_KEY;

    expect(resolveAiProviderConfig()).toBeNull();
  });

  // ── Explicit provider selection ──────────────────────────────────

  it("resolves explicit anthropic provider with key", () => {
    process.env.TRACECODE_AI_PROVIDER = "anthropic";
    process.env.TRACECODE_ANTHROPIC_KEY = "sk-ant-test";

    const config = resolveAiProviderConfig();
    expect(config).not.toBeNull();
    expect(config!.provider.id).toBe("anthropic");
    expect(config!.provider.wireFormat).toBe("anthropic");
    expect(config!.apiKey).toBe("sk-ant-test");
    expect(config!.model).toBe("claude-sonnet-4-20250514");
  });

  it("throws for explicit provider with no key", () => {
    process.env.TRACECODE_AI_PROVIDER = "anthropic";
    delete process.env.TRACECODE_ANTHROPIC_KEY;

    expect(() => resolveAiProviderConfig()).toThrow("no key is configured");
    expect(() => resolveAiProviderConfig()).toThrow("anthropic");
  });

  it("throws for unknown provider id", () => {
    process.env.TRACECODE_AI_PROVIDER = "nonexistent" as any;

    expect(() => resolveAiProviderConfig()).toThrow(
      "Unknown TRACECODE_AI_PROVIDER",
    );
    expect(() => resolveAiProviderConfig()).toThrow("nonexistent");
  });

  // ── OpenAI-compatible providers ──────────────────────────────────

  it("resolves explicit openai provider", () => {
    process.env.TRACECODE_AI_PROVIDER = "openai";
    process.env.TRACECODE_OPENAI_KEY = "sk-test";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("openai");
    expect(config!.provider.wireFormat).toBe("openai-compatible");
    expect(config!.baseUrl).toBe("https://api.openai.com/v1");
    expect(config!.model).toBe("gpt-4o-mini");
  });

  it("resolves explicit gemini provider", () => {
    process.env.TRACECODE_AI_PROVIDER = "gemini";
    process.env.TRACECODE_GEMINI_KEY = "ai-test";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("gemini");
    expect(config!.baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("resolves explicit groq provider", () => {
    process.env.TRACECODE_AI_PROVIDER = "groq";
    process.env.TRACECODE_GROQ_KEY = "gsk_test";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("groq");
    expect(config!.baseUrl).toBe("https://api.groq.com/openai/v1");
  });

  // ── Custom provider ──────────────────────────────────────────────

  it("resolves custom provider with base URL and model", () => {
    process.env.TRACECODE_AI_PROVIDER = "custom";
    process.env.TRACECODE_CUSTOM_KEY = "test-key";
    process.env.TRACECODE_AI_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.TRACECODE_AI_MODEL = "xiaomi/mimo-v2.5";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("custom");
    expect(config!.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config!.model).toBe("xiaomi/mimo-v2.5");
  });

  it("throws for custom provider without base URL", () => {
    process.env.TRACECODE_AI_PROVIDER = "custom";
    process.env.TRACECODE_CUSTOM_KEY = "test-key";
    delete process.env.TRACECODE_AI_BASE_URL;
    process.env.TRACECODE_AI_MODEL = "some-model";

    expect(() => resolveAiProviderConfig()).toThrow("TRACECODE_AI_BASE_URL");
  });

  it("throws for custom provider without model", () => {
    process.env.TRACECODE_AI_PROVIDER = "custom";
    process.env.TRACECODE_CUSTOM_KEY = "test-key";
    process.env.TRACECODE_AI_BASE_URL = "https://example.com/v1";
    delete process.env.TRACECODE_AI_MODEL;

    expect(() => resolveAiProviderConfig()).toThrow("TRACECODE_AI_MODEL");
  });

  // ── Auto-detection (no explicit TRACECODE_AI_PROVIDER) ───────────────

  it("auto-detects anthropic when only anthropic key is set", () => {
    delete process.env.TRACECODE_AI_PROVIDER;
    process.env.TRACECODE_ANTHROPIC_KEY = "sk-ant-test";
    delete process.env.TRACECODE_OPENAI_KEY;
    delete process.env.TRACECODE_GEMINI_KEY;
    delete process.env.TRACECODE_GROQ_KEY;
    delete process.env.TRACECODE_CUSTOM_KEY;

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("anthropic");
  });

  it("auto-detects openai when only openai key is set", () => {
    delete process.env.TRACECODE_AI_PROVIDER;
    delete process.env.TRACECODE_ANTHROPIC_KEY;
    process.env.TRACECODE_OPENAI_KEY = "sk-test";
    delete process.env.TRACECODE_GEMINI_KEY;
    delete process.env.TRACECODE_GROQ_KEY;
    delete process.env.TRACECODE_CUSTOM_KEY;

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("openai");
  });

  it("picks anthropic over openai when both keys are set", () => {
    delete process.env.TRACECODE_AI_PROVIDER;
    process.env.TRACECODE_ANTHROPIC_KEY = "sk-ant-test";
    process.env.TRACECODE_OPENAI_KEY = "sk-test";
    delete process.env.TRACECODE_GEMINI_KEY;
    delete process.env.TRACECODE_GROQ_KEY;
    delete process.env.TRACECODE_CUSTOM_KEY;

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("anthropic");
  });

  it("picks openai over gemini when both keys are set", () => {
    delete process.env.TRACECODE_AI_PROVIDER;
    delete process.env.TRACECODE_ANTHROPIC_KEY;
    process.env.TRACECODE_OPENAI_KEY = "sk-test";
    process.env.TRACECODE_GEMINI_KEY = "ai-test";
    delete process.env.TRACECODE_GROQ_KEY;
    delete process.env.TRACECODE_CUSTOM_KEY;

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("openai");
  });

  // ── Model override ───────────────────────────────────────────────

  it("uses TRACECODE_AI_MODEL to override default model", () => {
    process.env.TRACECODE_AI_PROVIDER = "openai";
    process.env.TRACECODE_OPENAI_KEY = "sk-test";
    process.env.TRACECODE_AI_MODEL = "gpt-4o";

    const config = resolveAiProviderConfig();
    expect(config!.model).toBe("gpt-4o");
  });

  it("uses default model when TRACECODE_AI_MODEL is not set", () => {
    process.env.TRACECODE_AI_PROVIDER = "openai";
    process.env.TRACECODE_OPENAI_KEY = "sk-test";
    delete process.env.TRACECODE_AI_MODEL;

    const config = resolveAiProviderConfig();
    expect(config!.model).toBe("gpt-4o-mini");
  });

  // ── Base URL override for custom ─────────────────────────────────

  it("custom provider uses TRACECODE_AI_BASE_URL", () => {
    process.env.TRACECODE_AI_PROVIDER = "custom";
    process.env.TRACECODE_CUSTOM_KEY = "test-key";
    process.env.TRACECODE_AI_BASE_URL = "http://localhost:11434/v1";
    process.env.TRACECODE_AI_MODEL = "llama3";

    const config = resolveAiProviderConfig();
    expect(config!.baseUrl).toBe("http://localhost:11434/v1");
    expect(config!.model).toBe("llama3");
  });

  it("non-custom provider ignores TRACECODE_AI_BASE_URL", () => {
    process.env.TRACECODE_AI_PROVIDER = "openai";
    process.env.TRACECODE_OPENAI_KEY = "sk-test";
    process.env.TRACECODE_AI_BASE_URL = "http://localhost:11434/v1";

    const config = resolveAiProviderConfig();
    expect(config!.baseUrl).toBe("https://api.openai.com/v1");
  });

  // ── Env var key lookup ───────────────────────────────────────────

  it("reads key from TRACECODE_<PROVIDER>_KEY env var", () => {
    process.env.TRACECODE_AI_PROVIDER = "groq";
    process.env.TRACECODE_GROQ_KEY = "gsk_abc123";

    const config = resolveAiProviderConfig();
    expect(config!.apiKey).toBe("gsk_abc123");
  });

  // ── Auto-detect edge cases ──────────────────────────────────────

  it("skips misconfigured custom provider during auto-detect", () => {
    // Stale custom key file but no base URL/model — should not crash,
    // should fall through to null (template fallback).
    delete process.env.TRACECODE_AI_PROVIDER;
    delete process.env.TRACECODE_ANTHROPIC_KEY;
    delete process.env.TRACECODE_OPENAI_KEY;
    delete process.env.TRACECODE_GEMINI_KEY;
    delete process.env.TRACECODE_GROQ_KEY;
    process.env.TRACECODE_CUSTOM_KEY = "stale-key";

    const config = resolveAiProviderConfig();
    expect(config).toBeNull();
  });

  it("picks openai over misconfigured custom during auto-detect", () => {
    delete process.env.TRACECODE_AI_PROVIDER;
    delete process.env.TRACECODE_ANTHROPIC_KEY;
    process.env.TRACECODE_OPENAI_KEY = "sk-test";
    process.env.TRACECODE_CUSTOM_KEY = "stale-key";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("openai");
  });

  // ── Model resolution ────────────────────────────────────────────

  it("uses provider defaultModel when no model override is set", () => {
    process.env.TRACECODE_AI_PROVIDER = "openai";
    process.env.TRACECODE_OPENAI_KEY = "sk-test";
    delete process.env.TRACECODE_AI_MODEL;

    const config = resolveAiProviderConfig();
    expect(config!.model).toBe("gpt-4o-mini");
  });

  it("TRACECODE_AI_MODEL env var overrides default for any provider", () => {
    process.env.TRACECODE_AI_PROVIDER = "groq";
    process.env.TRACECODE_GROQ_KEY = "gsk_test";
    process.env.TRACECODE_AI_MODEL = "llama-3.1-8b-instant";

    const config = resolveAiProviderConfig();
    expect(config!.model).toBe("llama-3.1-8b-instant");
  });

  it("TRACECODE_AI_MODEL applies globally to whichever provider is detected", () => {
    delete process.env.TRACECODE_AI_PROVIDER;
    process.env.TRACECODE_ANTHROPIC_KEY = "sk-ant-test";
    process.env.TRACECODE_AI_MODEL = "claude-3-haiku-20240307";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("anthropic");
    expect(config!.model).toBe("claude-3-haiku-20240307");
  });
});

// ── fetchModelsForProvider ─────────────────────────────────────────

const { fetchModelsForProvider } =
  await import("../../src/summarize/providers.js");

describe("fetchModelsForProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches models for anthropic provider", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "claude-sonnet-4" }, { id: "claude-3-haiku" }],
      }),
    });

    const models = await fetchModelsForProvider("anthropic", "sk-ant-test");
    expect(models).toEqual(["claude-sonnet-4", "claude-3-haiku"]);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      {
        headers: {
          "x-api-key": "sk-ant-test",
          "anthropic-version": "2023-06-01",
        },
      },
    );
  });

  it("fetches models for openai provider (sorted)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
    });

    const models = await fetchModelsForProvider("openai", "sk-test", undefined);
    expect(models).toEqual(["gpt-4o", "gpt-4o-mini"]);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      {
        headers: { Authorization: "Bearer sk-test" },
      },
    );
  });

  it("fetches models for groq provider", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "llama-3.3-70b-versatile" }] }),
    });

    const models = await fetchModelsForProvider("groq", "gsk_test");
    expect(models).toEqual(["llama-3.3-70b-versatile"]);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/models",
      {
        headers: { Authorization: "Bearer gsk_test" },
      },
    );
  });

  it("fetches models for gemini provider with x-goog-api-key header", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "models/gemini-3.6-flash" },
          { name: "models/gemini-2.5-pro" },
        ],
      }),
    });

    const models = await fetchModelsForProvider("gemini", "test-gemini-key");
    expect(models).toEqual(["gemini-2.5-pro", "gemini-3.6-flash"]);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      { headers: { "x-goog-api-key": "test-gemini-key" } },
    );
  });

  it("fetches models for custom provider with base URL", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "local-model" }] }),
    });

    const models = await fetchModelsForProvider(
      "custom",
      "test-key",
      "http://localhost:11434/v1",
    );
    expect(models).toEqual(["local-model"]);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      {
        headers: { Authorization: "Bearer test-key" },
      },
    );
  });

  it("throws for custom provider without base URL", async () => {
    await expect(
      fetchModelsForProvider("custom", "test-key", undefined),
    ).rejects.toThrow("No base URL available");
  });

  it("throws when API returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    await expect(fetchModelsForProvider("openai", "bad-key")).rejects.toThrow(
      "Failed to list models (401)",
    );
  });

  it("returns empty list when data array is empty", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const models = await fetchModelsForProvider("openai", "sk-test");
    expect(models).toEqual([]);
  });

  it("returns empty list when data field is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const models = await fetchModelsForProvider("openai", "sk-test");
    expect(models).toEqual([]);
  });
});
