import { describe, it, expect, vi } from "vitest";
import type { HistoryEntry } from "../../src/graph/query.js";

// Mock the @anthropic-ai/sdk module before importing ai.ts
const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "This code implements a database connection layer." }],
});

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// Dynamic import after mock is set up
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

describe("createAiSummarizer", () => {
  it("returns a Summarizer interface with summarize and summarizeJson methods", async () => {
    const summarizer = await createAiSummarizer("test-key");
    expect(typeof summarizer.summarize).toBe("function");
    expect(typeof summarizer.summarizeJson).toBe("function");
  });

  it("returns 'none' confidence for empty history (text mode)", async () => {
    const summarizer = await createAiSummarizer("test-key");
    const result = await summarizer.summarize([], "src/foo.ts:42");
    expect(result.confidence).toBe("none");
    expect(result.text).toContain("No history found");
  });

  it("returns 'none' confidence for empty history (JSON mode)", async () => {
    const summarizer = await createAiSummarizer("test-key");
    const result = await summarizer.summarizeJson([], "src/foo.ts:42");
    expect(result.confidence).toBe("none");
    expect(result.commitCount).toBe(0);
    expect(result.history).toEqual([]);
  });

  it("calls the Anthropic API and returns AI-inferred confidence", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "This code implements a database connection layer." }],
    });

    const summarizer = await createAiSummarizer("test-key");
    const result = await summarizer.summarize(SAMPLE_HISTORY, "openDatabase");

    expect(result.confidence).toBe("ai-inferred");
    expect(result.text).toContain("AI analysis:");
    expect(result.text).toContain("database connection layer");
    expect(mockCreate).toHaveBeenCalled();
  });

  it("includes template header before AI analysis in text mode", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Some AI text" }],
    });

    const summarizer = await createAiSummarizer("test-key");
    const result = await summarizer.summarize(SAMPLE_HISTORY, "openDatabase");
    expect(result.text).toContain("Why does openDatabase exist?");
    expect(result.text).toContain("Alice");
    expect(result.text).toContain("AI analysis:");
  });

  it("returns aiSummary in JSON mode", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "AI summary text" }],
    });

    const summarizer = await createAiSummarizer("test-key");
    const result = await summarizer.summarizeJson(SAMPLE_HISTORY, "openDatabase");
    expect(result.aiSummary).toBe("AI summary text");
    expect(result.confidence).toBe("ai-inferred");
    expect(result.commitCount).toBe(2);
    expect(result.history).toBe(SAMPLE_HISTORY);
  });

  it("gracefully handles API errors in text mode", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Invalid API key"));

    const summarizer = await createAiSummarizer("test-key");
    const result = await summarizer.summarize(SAMPLE_HISTORY, "openDatabase");

    // Should fall back to documented confidence with error message
    expect(result.confidence).toBe("documented");
    expect(result.text).toContain("AI analysis unavailable");
    expect(result.text).toContain("Invalid API key");
  });

  it("gracefully handles API errors in JSON mode", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Rate limited"));

    const summarizer = await createAiSummarizer("test-key");
    const result = await summarizer.summarizeJson(SAMPLE_HISTORY, "openDatabase");

    expect(result.confidence).toBe("documented");
    expect(result.aiSummary).toBeUndefined();
    expect(result.commitCount).toBe(2);
  });
});
