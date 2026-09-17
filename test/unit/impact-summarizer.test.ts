import { describe, it, expect, afterEach, vi } from "vitest";
import type { EnrichedDependent } from "../../src/summarize/impact-types.js";

// Mock tokens.ts so tests only read from env vars.
vi.mock("../../src/config/tokens.js", () => ({
  getProviderKey: (id: string) => process.env[`PRISM_${id.toUpperCase()}_KEY`],
  getModel: (id: string) => process.env.PRISM_AI_MODEL,
  getActiveProvider: () => undefined,
}));

const { createTemplateImpactSummarizer } = await import("../../src/summarize/impact-template.js");
const { createAiOpenAiImpactSummarizer } = await import("../../src/summarize/impact-ai.js");

// Fixtures for testing impact summarizers.
const mockDirectDependent: EnrichedDependent = {
  file: "src/cli/commands/why.ts",
  symbol: "registerWhyCommand",
  kind: "function",
  depth: 1,
  edgeType: "calls",
  symbolId: 1,
  startLine: 10,
  endLine: 30,
  sourceSnippet: `function registerWhyCommand(program: Command) {\n  program.command("why")\n    .action(() => { openDatabase(); });\n}`,
  history: [
    { commitSha: "abc1234567890", message: "feat: add why command", date: "2025-01-15", author: "dev", prNumbers: [1], prTitles: ["Add why command"] },
  ],
};

const mockTransitiveDependent: EnrichedDependent = {
  file: "src/cli/index.ts",
  symbol: "registerCommands",
  kind: "function",
  depth: 2,
  edgeType: "calls",
  symbolId: 2,
  startLine: 5,
  endLine: 15,
  sourceSnippet: null,
  history: [],
};

const mockImportDependent: EnrichedDependent = {
  file: "src/summarize/template.ts",
  symbol: "buildTemplateSummary",
  kind: "function",
  depth: 1,
  edgeType: "imports",
  symbolId: 3,
  startLine: 30,
  endLine: 70,
  sourceSnippet: "export function buildTemplateSummary(history, target) { ... }",
  history: [],
};

const mockEmptyDependents: EnrichedDependent[] = [];
const mockSingleDependent: EnrichedDependent[] = [mockDirectDependent];
const mockMultipleDependents: EnrichedDependent[] = [
  mockDirectDependent,
  mockTransitiveDependent,
  mockImportDependent,
];

// ── Template impact summarizer ─────────────────────────────────

describe("createTemplateImpactSummarizer", () => {
  it("returns 'none' confidence when no dependents", async () => {
    const summarizer = createTemplateImpactSummarizer();
    const result = await summarizer.summarizeImpact("test:target", mockEmptyDependents);
    expect(result.confidence).toBe("none");
    expect(result.text).toContain("No dependents found");
  });

  it("returns 'documented' confidence with dependents", async () => {
    const summarizer = createTemplateImpactSummarizer();
    const result = await summarizer.summarizeImpact("test:target", mockSingleDependent);
    expect(result.confidence).toBe("documented");
    expect(result.text).toContain("Impact of changing test:target");
  });

  it("includes direct and transitive in text output", async () => {
    const summarizer = createTemplateImpactSummarizer();
    const result = await summarizer.summarizeImpact("test:target", mockMultipleDependents);
    expect(result.text).toContain("Direct dependents:");
    expect(result.text).toContain("Transitive dependents");
    expect(result.text).toContain("registerWhyCommand");
    expect(result.text).toContain("registerCommands");
  });

  it("shows edge type in text output", async () => {
    const summarizer = createTemplateImpactSummarizer();
    const result = await summarizer.summarizeImpact("test:target", mockSingleDependent);
    expect(result.text).toContain("calls");
  });

  it("shows import edge type separately", async () => {
    const summarizer = createTemplateImpactSummarizer();
    const result = await summarizer.summarizeImpact("test:target", [mockImportDependent]);
    expect(result.text).toContain("imports");
  });

  it("shows commit history for direct dependents", async () => {
    const summarizer = createTemplateImpactSummarizer();
    const result = await summarizer.summarizeImpact("test:target", mockSingleDependent);
    expect(result.text).toContain("feat: add why command");
    expect(result.text).toContain("2025-01-15");
  });

  it("returns correct JSON shape", async () => {
    const summarizer = createTemplateImpactSummarizer();
    const result = await summarizer.summarizeImpactJson("test:target", mockMultipleDependents);
    expect(result.target).toBe("test:target");
    expect(result.dependentCount).toBe(3);
    expect(result.directCount).toBe(2);
    expect(result.transitiveCount).toBe(1);
    expect(result.confidence).toBe("documented");
  });

  it("returns 'none' confidence in JSON when no dependents", async () => {
    const summarizer = createTemplateImpactSummarizer();
    const result = await summarizer.summarizeImpactJson("test:target", mockEmptyDependents);
    expect(result.confidence).toBe("none");
    expect(result.dependentCount).toBe(0);
  });
});

// ── AI impact summarizer ───────────────────────────────────────

describe("createAiOpenAiImpactSummarizer", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.PRISM_AI_PROVIDER;
  });

  it("calls model and includes AI summary in text output", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "openDatabase is used at startup to initialize the DB." } }],
      }),
    });

    const summarizer = createAiOpenAiImpactSummarizer({
      provider: { id: "openai", wireFormat: "openai-compatible", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", authFormat: "bearer" },
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });

    const result = await summarizer.summarizeImpact("src/store/db.ts:openDatabase", mockSingleDependent);
    expect(result.confidence).toBe("ai-inferred");
    expect(result.text).toContain("AI Impact Analysis:");
    expect(result.text).toContain("openDatabase is used at startup");
  });

  it("calls model and includes AI summary in JSON output", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Impact analysis text." } }],
      }),
    });

    const summarizer = createAiOpenAiImpactSummarizer({
      provider: { id: "openai", wireFormat: "openai-compatible", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", authFormat: "bearer" },
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });

    const result = await summarizer.summarizeImpactJson("test:target", mockSingleDependent);
    expect(result.confidence).toBe("ai-inferred");
    expect(result.aiSummary).toBe("Impact analysis text.");
    expect(result.dependentCount).toBe(1);
  });

  it("falls back to documented confidence on API error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const summarizer = createAiOpenAiImpactSummarizer({
      provider: { id: "openai", wireFormat: "openai-compatible", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", authFormat: "bearer" },
      apiKey: "bad-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });

    const result = await summarizer.summarizeImpact("test:target", mockSingleDependent);
    expect(result.confidence).toBe("documented");
    expect(result.text).toContain("AI impact analysis unavailable");
  });

  it("returns none confidence when no dependents", async () => {
    const summarizer = createAiOpenAiImpactSummarizer({
      provider: { id: "openai", wireFormat: "openai-compatible", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", authFormat: "bearer" },
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });

    const result = await summarizer.summarizeImpact("test:target", mockEmptyDependents);
    expect(result.confidence).toBe("none");
    expect(result.text).toContain("No dependents found");
  });

  it("builds correct prompt with source snippets and edge types", async () => {
    let capturedPrompt = "";
    global.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
      const body = JSON.parse(opts.body);
      capturedPrompt = body.messages[0].content;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "ok" } }],
        }),
      };
    });

    const summarizer = createAiOpenAiImpactSummarizer({
      provider: { id: "openai", wireFormat: "openai-compatible", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", authFormat: "bearer" },
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });

    await summarizer.summarizeImpact("src/store/db.ts:openDatabase", mockMultipleDependents);

    expect(capturedPrompt).toContain("src/store/db.ts:openDatabase");
    expect(capturedPrompt).toContain("calls");
    expect(capturedPrompt).toContain("imports");
    expect(capturedPrompt).toContain("registerWhyCommand");
    expect(capturedPrompt).toContain("function registerWhyCommand");
    expect(capturedPrompt).toContain("buildTemplateSummary");
  });
});
