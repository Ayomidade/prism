import { describe, it, expect } from "vitest";
import { escapeHtml, generateImpactHtml } from "../../src/cli/output/html.js";
import type { Dependent } from "../../src/graph/query.js";

// ── escapeHtml ──────────────────────────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;"
    );
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('foo "bar"')).toBe("foo &quot;bar&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#039;s");
  });

  it("escapes multiple special characters in one string", () => {
    const input = '<img src=x onerror=alert("XSS")>';
    const result = escapeHtml(input);
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain('"');
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
    expect(result).toContain("&quot;");
  });

  it("returns plain strings unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
    expect(escapeHtml("src/store/db.ts:42")).toBe("src/store/db.ts:42");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

// ── generateImpactHtml ──────────────────────────────────────────────────────

const SAMPLE_DEPS: Dependent[] = [
  { file: "src/cli/commands/impact.ts", symbol: "registerImpactCommand", kind: "function", depth: 1 },
  { file: "src/cli/commands/impact.ts", symbol: "formatTree", kind: "function", depth: 2 },
  { file: "src/graph/query.ts", symbol: "resolveSymbol", kind: "function", depth: 1 },
];

describe("generateImpactHtml", () => {
  it("returns a complete HTML document", () => {
    const html = generateImpactHtml("openDatabase", SAMPLE_DEPS);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
  });

  it("includes the target symbol in the header", () => {
    const html = generateImpactHtml("openDatabase", []);
    expect(html).toContain("openDatabase");
  });

  it("shows correct dependent count", () => {
    const html = generateImpactHtml("openDatabase", SAMPLE_DEPS);
    expect(html).toContain("3"); // total
    expect(html).toContain("2"); // direct (depth 1)
    expect(html).toContain("1"); // transitive (depth > 1)
  });

  it("shows 'No dependents found' for empty list", () => {
    const html = generateImpactHtml("leafFn", []);
    expect(html).toContain("No dependents found");
    expect(html).toContain("0"); // total = 0
  });

  it("renders file paths in the tree", () => {
    const html = generateImpactHtml("target", SAMPLE_DEPS);
    expect(html).toContain("src/cli/commands/impact.ts");
    expect(html).toContain("src/graph/query.ts");
  });

  it("renders symbol names in the tree", () => {
    const html = generateImpactHtml("target", SAMPLE_DEPS);
    expect(html).toContain("registerImpactCommand");
    expect(html).toContain("formatTree");
    expect(html).toContain("resolveSymbol");
  });

  it("shows depth badges for transitive dependents (depth > 1)", () => {
    const html = generateImpactHtml("target", SAMPLE_DEPS);
    expect(html).toContain("depth 2");
  });

  it("does not show depth badge for direct dependents (depth 1)", () => {
    const html = generateImpactHtml("target", SAMPLE_DEPS);
    // Direct deps shouldn't have "depth 1" badge
    const lines = html.split("\n");
    const directLines = lines.filter((l) => l.includes("registerImpactCommand") || l.includes("resolveSymbol"));
    for (const line of directLines) {
      expect(line).not.toContain("depth 1");
    }
  });

  it("includes repo name when provided", () => {
    const html = generateImpactHtml("target", [], { repoName: "acme/my-app" });
    expect(html).toContain("acme/my-app");
  });

  it("includes generation timestamp", () => {
    const ts = "2026-09-11T15:00:00.000Z";
    const html = generateImpactHtml("target", [], { generatedAt: ts });
    expect(html).toContain(ts);
  });

  it("is responsive (has viewport meta tag)", () => {
    const html = generateImpactHtml("target", []);
    expect(html).toContain("<meta name=\"viewport\"");
  });

  it("has no external dependencies (self-contained)", () => {
    const html = generateImpactHtml("target", SAMPLE_DEPS);
    // Should not reference any external CSS or JS files
    expect(html).not.toContain('href="http');
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('href="//');
    expect(html).not.toContain('src="//');
  });

  it("escapes XSS in file paths", () => {
    const xssDep: Dependent[] = [
      { file: "<script>alert('xss')</script>", symbol: "fn", kind: "function", depth: 1 },
    ];
    const html = generateImpactHtml("target", xssDep);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes XSS in symbol names", () => {
    const xssDep: Dependent[] = [
      { file: "src/a.ts", symbol: "<img src=x onerror=alert(1)>", kind: "function", depth: 1 },
    ];
    const html = generateImpactHtml("target", xssDep);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes XSS in the target symbol", () => {
    const html = generateImpactHtml("<script>xss</script>", []);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
