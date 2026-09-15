import { describe, it, expect, afterEach } from "vitest";
import { resolveAiProviderConfig } from "../../src/summarize/providers.js";

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
    delete process.env.PRISM_AI_PROVIDER;
    delete process.env.PRISM_ANTHROPIC_KEY;
    delete process.env.PRISM_OPENAI_KEY;
    delete process.env.PRISM_GEMINI_KEY;
    delete process.env.PRISM_GROQ_KEY;
    delete process.env.PRISM_CUSTOM_KEY;

    expect(resolveAiProviderConfig()).toBeNull();
  });

  // ── Explicit provider selection ──────────────────────────────────

  it("resolves explicit anthropic provider with key", () => {
    process.env.PRISM_AI_PROVIDER = "anthropic";
    process.env.PRISM_ANTHROPIC_KEY = "sk-ant-test";

    const config = resolveAiProviderConfig();
    expect(config).not.toBeNull();
    expect(config!.provider.id).toBe("anthropic");
    expect(config!.provider.wireFormat).toBe("anthropic");
    expect(config!.apiKey).toBe("sk-ant-test");
    expect(config!.model).toBe("claude-sonnet-4-20250514");
  });

  it("throws for explicit provider with no key", () => {
    process.env.PRISM_AI_PROVIDER = "anthropic";
    delete process.env.PRISM_ANTHROPIC_KEY;

    expect(() => resolveAiProviderConfig()).toThrow("no key is configured");
    expect(() => resolveAiProviderConfig()).toThrow("anthropic");
  });

  it("throws for unknown provider id", () => {
    process.env.PRISM_AI_PROVIDER = "nonexistent" as any;

    expect(() => resolveAiProviderConfig()).toThrow("Unknown PRISM_AI_PROVIDER");
    expect(() => resolveAiProviderConfig()).toThrow("nonexistent");
  });

  // ── OpenAI-compatible providers ──────────────────────────────────

  it("resolves explicit openai provider", () => {
    process.env.PRISM_AI_PROVIDER = "openai";
    process.env.PRISM_OPENAI_KEY = "sk-test";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("openai");
    expect(config!.provider.wireFormat).toBe("openai-compatible");
    expect(config!.baseUrl).toBe("https://api.openai.com/v1");
    expect(config!.model).toBe("gpt-4o-mini");
  });

  it("resolves explicit gemini provider", () => {
    process.env.PRISM_AI_PROVIDER = "gemini";
    process.env.PRISM_GEMINI_KEY = "ai-test";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("gemini");
    expect(config!.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("resolves explicit groq provider", () => {
    process.env.PRISM_AI_PROVIDER = "groq";
    process.env.PRISM_GROQ_KEY = "gsk_test";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("groq");
    expect(config!.baseUrl).toBe("https://api.groq.com/openai/v1");
  });

  // ── Custom provider ──────────────────────────────────────────────

  it("resolves custom provider with base URL and model", () => {
    process.env.PRISM_AI_PROVIDER = "custom";
    process.env.PRISM_CUSTOM_KEY = "test-key";
    process.env.PRISM_AI_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.PRISM_AI_MODEL = "xiaomi/mimo-v2.5";

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("custom");
    expect(config!.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config!.model).toBe("xiaomi/mimo-v2.5");
  });

  it("throws for custom provider without base URL", () => {
    process.env.PRISM_AI_PROVIDER = "custom";
    process.env.PRISM_CUSTOM_KEY = "test-key";
    delete process.env.PRISM_AI_BASE_URL;
    process.env.PRISM_AI_MODEL = "some-model";

    expect(() => resolveAiProviderConfig()).toThrow("PRISM_AI_BASE_URL");
  });

  it("throws for custom provider without model", () => {
    process.env.PRISM_AI_PROVIDER = "custom";
    process.env.PRISM_CUSTOM_KEY = "test-key";
    process.env.PRISM_AI_BASE_URL = "https://example.com/v1";
    delete process.env.PRISM_AI_MODEL;

    expect(() => resolveAiProviderConfig()).toThrow("PRISM_AI_MODEL");
  });

  // ── Auto-detection (no explicit PRISM_AI_PROVIDER) ───────────────

  it("auto-detects anthropic when only anthropic key is set", () => {
    delete process.env.PRISM_AI_PROVIDER;
    process.env.PRISM_ANTHROPIC_KEY = "sk-ant-test";
    delete process.env.PRISM_OPENAI_KEY;
    delete process.env.PRISM_GEMINI_KEY;
    delete process.env.PRISM_GROQ_KEY;
    delete process.env.PRISM_CUSTOM_KEY;

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("anthropic");
  });

  it("auto-detects openai when only openai key is set", () => {
    delete process.env.PRISM_AI_PROVIDER;
    delete process.env.PRISM_ANTHROPIC_KEY;
    process.env.PRISM_OPENAI_KEY = "sk-test";
    delete process.env.PRISM_GEMINI_KEY;
    delete process.env.PRISM_GROQ_KEY;
    delete process.env.PRISM_CUSTOM_KEY;

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("openai");
  });

  it("picks anthropic over openai when both keys are set", () => {
    delete process.env.PRISM_AI_PROVIDER;
    process.env.PRISM_ANTHROPIC_KEY = "sk-ant-test";
    process.env.PRISM_OPENAI_KEY = "sk-test";
    delete process.env.PRISM_GEMINI_KEY;
    delete process.env.PRISM_GROQ_KEY;
    delete process.env.PRISM_CUSTOM_KEY;

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("anthropic");
  });

  it("picks openai over gemini when both keys are set", () => {
    delete process.env.PRISM_AI_PROVIDER;
    delete process.env.PRISM_ANTHROPIC_KEY;
    process.env.PRISM_OPENAI_KEY = "sk-test";
    process.env.PRISM_GEMINI_KEY = "ai-test";
    delete process.env.PRISM_GROQ_KEY;
    delete process.env.PRISM_CUSTOM_KEY;

    const config = resolveAiProviderConfig();
    expect(config!.provider.id).toBe("openai");
  });

  // ── Model override ───────────────────────────────────────────────

  it("uses PRISM_AI_MODEL to override default model", () => {
    process.env.PRISM_AI_PROVIDER = "openai";
    process.env.PRISM_OPENAI_KEY = "sk-test";
    process.env.PRISM_AI_MODEL = "gpt-4o";

    const config = resolveAiProviderConfig();
    expect(config!.model).toBe("gpt-4o");
  });

  it("uses default model when PRISM_AI_MODEL is not set", () => {
    process.env.PRISM_AI_PROVIDER = "openai";
    process.env.PRISM_OPENAI_KEY = "sk-test";
    delete process.env.PRISM_AI_MODEL;

    const config = resolveAiProviderConfig();
    expect(config!.model).toBe("gpt-4o-mini");
  });

  // ── Base URL override for custom ─────────────────────────────────

  it("custom provider uses PRISM_AI_BASE_URL", () => {
    process.env.PRISM_AI_PROVIDER = "custom";
    process.env.PRISM_CUSTOM_KEY = "test-key";
    process.env.PRISM_AI_BASE_URL = "http://localhost:11434/v1";
    process.env.PRISM_AI_MODEL = "llama3";

    const config = resolveAiProviderConfig();
    expect(config!.baseUrl).toBe("http://localhost:11434/v1");
    expect(config!.model).toBe("llama3");
  });

  it("non-custom provider ignores PRISM_AI_BASE_URL", () => {
    process.env.PRISM_AI_PROVIDER = "openai";
    process.env.PRISM_OPENAI_KEY = "sk-test";
    process.env.PRISM_AI_BASE_URL = "http://localhost:11434/v1";

    const config = resolveAiProviderConfig();
    expect(config!.baseUrl).toBe("https://api.openai.com/v1");
  });

  // ── Env var key lookup ───────────────────────────────────────────

  it("reads key from PRISM_<PROVIDER>_KEY env var", () => {
    process.env.PRISM_AI_PROVIDER = "groq";
    process.env.PRISM_GROQ_KEY = "gsk_abc123";

    const config = resolveAiProviderConfig();
    expect(config!.apiKey).toBe("gsk_abc123");
  });
});
