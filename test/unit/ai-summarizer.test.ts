import { describe, it, expect, vi, afterEach } from "vitest";
import type { HistoryEntry } from "../../src/graph/query.js";

// Mock the @anthropic-ai/sdk module at module scope (vitest hoists vi.mock)
const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "This code implements a database connection layer." }],
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

const { createAiSummarizer } = await import("../../src/summarize/ai.js");

const SAMPLE_HISTORY: HistoryEntry[] = [
  {
    commitSha: "abc1234567890abcdef1234567890abcdef1234",
    message: "Add schema version check",
    date: "2026-09-10T09:00:00Z",
    author: "Alice",
    prNumbers: [42],
    prTitles: ["Add schema validation"],
  },
  {
    commitSha: "def5678901234abcdef01234567890abcdef5678",
    message: "Refactor openDatabase",
    date: "2026-09-05T14:30:00Z",
    author: "Bob",
    prNumbers: [],
    prTitles: [],
  },
];

describe("createAiSummarizer (factory)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "This code implements a database connection layer." }],
    });
  });

  it("falls back to template summarizer when no provider configured", async () => {
    delete process.env.PRISM_AI_PROVIDER;
    delete process.env.PRISM_ANTHROPIC_KEY;
    delete process.env.PRISM_OPENAI_KEY;
    delete process.env.PRISM_GEMINI_KEY;
    delete process.env.PRISM_GROQ_KEY;

    const summarizer = await createAiSummarizer();
    // Template summarizer returns "documented" confidence
    const result = await summarizer.summarize(SAMPLE_HISTORY, "openDatabase");
    expect(result.confidence).toBe("documented");
    expect(result.text).toContain("Why does openDatabase exist?");
  });

  it("returns empty-history result for template summarizer", async () => {
    delete process.env.PRISM_AI_PROVIDER;
    delete process.env.PRISM_ANTHROPIC_KEY;

    const summarizer = await createAiSummarizer();
    const result = await summarizer.summarize([], "src/foo.ts:42");
    expect(result.text).toContain("No history found");
  });
});

describe("Anthropic provider (mocked)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "This code implements a database connection layer." }],
    });
  });

  it("calls the Anthropic API and returns AI-inferred confidence", async () => {
    process.env.PRISM_ANTHROPIC_KEY = "test-key";

    const summarizer = await createAiSummarizer();
    const result = await summarizer.summarize(SAMPLE_HISTORY, "openDatabase");

    expect(result.confidence).toBe("ai-inferred");
    expect(result.text).toContain("AI analysis:");
    expect(result.text).toContain("database connection layer");
    expect(mockCreate).toHaveBeenCalled();
  });

  it("includes template header before AI analysis", async () => {
    process.env.PRISM_ANTHROPIC_KEY = "test-key";
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Some AI text" }],
    });

    const summarizer = await createAiSummarizer();
    const result = await summarizer.summarize(SAMPLE_HISTORY, "openDatabase");
    expect(result.text).toContain("Why does openDatabase exist?");
    expect(result.text).toContain("Alice");
    expect(result.text).toContain("AI analysis:");
  });

  it("returns aiSummary in JSON mode", async () => {
    process.env.PRISM_ANTHROPIC_KEY = "test-key";
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "AI summary text" }],
    });

    const summarizer = await createAiSummarizer();
    const result = await summarizer.summarizeJson(SAMPLE_HISTORY, "openDatabase");
    expect(result.aiSummary).toBe("AI summary text");
    expect(result.confidence).toBe("ai-inferred");
    expect(result.commitCount).toBe(2);
    expect(result.history).toBe(SAMPLE_HISTORY);
  });

  it("gracefully handles API errors in text mode", async () => {
    process.env.PRISM_ANTHROPIC_KEY = "test-key";
    mockCreate.mockRejectedValueOnce(new Error("Invalid API key"));

    const summarizer = await createAiSummarizer();
    const result = await summarizer.summarize(SAMPLE_HISTORY, "openDatabase");

    expect(result.confidence).toBe("documented");
    expect(result.text).toContain("AI analysis unavailable");
    expect(result.text).toContain("Invalid API key");
  });

  it("gracefully handles API errors in JSON mode", async () => {
    process.env.PRISM_ANTHROPIC_KEY = "test-key";
    mockCreate.mockRejectedValueOnce(new Error("Rate limited"));

    const summarizer = await createAiSummarizer();
    const result = await summarizer.summarizeJson(SAMPLE_HISTORY, "openDatabase");

    expect(result.confidence).toBe("documented");
    expect(result.aiSummary).toBeUndefined();
    expect(result.commitCount).toBe(2);
  });
});
