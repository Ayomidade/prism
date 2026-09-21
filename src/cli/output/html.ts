import { VERSION } from "../../config/version.js";
import type { Dependent } from "../../graph/query.js";

// ──────────────────────────────────────────────────────────────────────────────
// html.ts — Standalone responsive HTML report generator for `tracecode impact`
// ──────────────────────────────────────────────────────────────────────────────
//
// Generates a single self-contained HTML file that can be opened in any browser
// without a server. All CSS and JS are inlined — no external dependencies.
//
// Security: All user-controlled content (file paths, symbol names, commit
// messages) is escaped via escapeHtml() before injection into the HTML to
// prevent stored XSS if a report is ever shared or hosted.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Escapes HTML special characters to prevent XSS when injecting
 * user-controlled content into HTML.
 *
 * Handles: & < > " '
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generates a standalone, responsive HTML report for impact results.
 *
 * @param target     - The symbol that was queried (e.g. "src/store/db.ts:openDatabase")
 * @param dependents - List of dependents from queryDependents()
 * @param options    - Optional metadata (repo name, generation timestamp)
 * @returns Complete HTML string ready to write to a file
 */
export function generateImpactHtml(
  target: string,
  dependents: Dependent[],
  options?: { repoName?: string; generatedAt?: string; aiSummary?: string },
): string {
  const safeTarget = escapeHtml(target);
  const safeRepo = escapeHtml(options?.repoName ?? "Repository");
  const timestamp = options?.generatedAt ?? new Date().toISOString();
  const safeTimestamp = formatTimestamp(timestamp);
  const safeAiSummary = options?.aiSummary
    ? renderMarkdown(options.aiSummary)
    : null;
  const count = dependents.length;

  // Group dependents by file for the tree view
  const byFile = new Map<string, Dependent[]>();
  for (const dep of dependents) {
    const existing = byFile.get(dep.file);
    if (existing) {
      existing.push(dep);
    } else {
      byFile.set(dep.file, [dep]);
    }
  }
  const sortedFiles = [...byFile.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  // Build the tree HTML
  let treeHtml: string;
  if (count === 0) {
    treeHtml = `<p class="empty">No dependents found. This symbol is a leaf — changing it won't break anything in the indexed graph.</p>`;
  } else {
    treeHtml = `<div class="tree">`;
    for (const [file, deps] of sortedFiles) {
      const safeFile = escapeHtml(file);
      treeHtml += `<div class="tree-file">`;
      treeHtml += `<span class="file-icon">📄</span> <span class="file-path">${safeFile}</span>`;
      treeHtml += `<ul class="tree-symbols">`;
      for (const dep of deps) {
        const safeSymbol = escapeHtml(
          dep.kind === "module" ? `${dep.symbol} (top-level code)` : dep.symbol,
        );
        const depthClass = `depth-${Math.min(dep.depth, 4)}`;
        treeHtml += `<li class="${depthClass}">`;
        treeHtml += `<span class="symbol-kind">${getKindIcon(dep)}</span> `;
        treeHtml += `<span class="symbol-name">${safeSymbol}</span>`;
        if (dep.depth > 1) {
          treeHtml += ` <span class="depth-badge">depth ${dep.depth}</span>`;
        }
        treeHtml += `</li>`;
      }
      treeHtml += `</ul></div>`;
    }
    treeHtml += `</div>`;
  }

  // Summary stats
  const directDeps = dependents.filter((d) => d.depth === 1).length;
  const transitiveDeps = count - directDeps;
  const uniqueFiles = sortedFiles.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TRACECODE Impact Report — ${safeTarget}</title>
<style>
  /* ── Reset & Base ──────────────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 16px; -webkit-text-size-adjust: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    line-height: 1.6;
    color: #1a1a2e;
    background: #f8f9fa;
    padding: 1rem;
  }

  /* ── Layout ────────────────────────────────────────────────────────── */
  .container {
    max-width: 900px;
    margin: 0 auto;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);
    overflow: hidden;
  }

  /* ── Header ────────────────────────────────────────────────────────── */
  .header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #fff;
    padding: 2rem;
  }
  .header h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }
  .header .target {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 1.1rem;
    color: #7ec8e3;
    word-break: break-all;
  }
  .header .subtitle {
    color: #94a3b8;
    font-size: 0.875rem;
    margin-top: 0.5rem;
  }

  /* ── Stats ─────────────────────────────────────────────────────────── */
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
    padding: 1.5rem 2rem;
    border-bottom: 1px solid #e2e8f0;
  }
  .stat {
    text-align: center;
  }
  .stat-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: #1a1a2e;
  }
  .stat-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
    margin-top: 0.25rem;
  }

  /* ── Tree ──────────────────────────────────────────────────────────── */
  .tree-section {
    padding: 1.5rem 2rem;
  }
  .tree-section h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: #334155;
  }
  .tree-file {
    margin-bottom: 1rem;
    background: #f8fafc;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    border: 1px solid #e2e8f0;
  }
  .file-icon { font-size: 0.9rem; }
  .file-path {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 0.85rem;
    font-weight: 600;
    color: #1e293b;
  }
  .tree-symbols {
    list-style: none;
    margin-top: 0.5rem;
    padding-left: 1.5rem;
  }
  .tree-symbols li {
    padding: 0.2rem 0;
    font-size: 0.9rem;
    color: #475569;
    position: relative;
  }
  .tree-symbols li::before {
    content: '';
    position: absolute;
    left: -1rem;
    top: 0.6rem;
    width: 0.5rem;
    height: 1px;
    background: #cbd5e1;
  }
  .depth-1 { padding-left: 0; }
  .depth-2 { padding-left: 1rem; }
  .depth-3 { padding-left: 2rem; }
  .depth-4 { padding-left: 3rem; }
  .symbol-kind { font-size: 0.8rem; }
  .symbol-name {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-weight: 500;
    color: #1e293b;
  }
  .depth-badge {
    display: inline-block;
    font-size: 0.65rem;
    background: #e2e8f0;
    color: #64748b;
    border-radius: 4px;
    padding: 0.1rem 0.4rem;
    margin-left: 0.5rem;
    vertical-align: middle;
  }

  /* ── AI Analysis ──────────────────────────────────────────────────── */
  .ai-section {
    padding: 1.5rem 2rem;
    border-bottom: 1px solid #e2e8f0;
  }
  .ai-section h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: #334155;
  }
  .ai-summary {
    color: #475569;
    line-height: 1.7;
    white-space: pre-wrap;
  }
  .ai-summary pre {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin: 0.75rem 0;
    overflow-x: auto;
  }
  .ai-summary code {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 0.85rem;
    color: #334155;
  }
  .ai-summary br {
    content: '';
    display: block;
    margin-bottom: 0.25rem;
  }

  /* ── Empty state ───────────────────────────────────────────────────── */
  .empty {
    color: #64748b;
    font-style: italic;
    padding: 1rem 0;
  }

  /* ── Footer ────────────────────────────────────────────────────────── */
  .footer {
    padding: 1rem 2rem;
    border-top: 1px solid #e2e8f0;
    font-size: 0.75rem;
    color: #94a3b8;
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* ── Responsive ────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    body { padding: 0.5rem; }
    .container { border-radius: 8px; }
    .header { padding: 1.25rem; }
    .header h1 { font-size: 1.25rem; }
    .header .target { font-size: 0.95rem; }
    .stats { grid-template-columns: repeat(2, 1fr); padding: 1rem; }
    .stat-value { font-size: 1.5rem; }
    .tree-section { padding: 1rem; }
    .tree-file { padding: 0.5rem 0.75rem; }
    .tree-symbols { padding-left: 1rem; }
    .depth-2 { padding-left: 0.5rem; }
    .depth-3 { padding-left: 1rem; }
    .depth-4 { padding-left: 1.5rem; }
    .footer { flex-direction: column; text-align: center; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🔗 Dependency Impact Report</h1>
    <div class="target">${safeTarget}</div>
    <div class="subtitle">${safeRepo} · Generated ${safeTimestamp}</div>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${count}</div>
      <div class="stat-label">Total Dependents</div>
    </div>
    <div class="stat">
      <div class="stat-value">${directDeps}</div>
      <div class="stat-label">Direct</div>
    </div>
    <div class="stat">
      <div class="stat-value">${transitiveDeps}</div>
      <div class="stat-label">Transitive</div>
    </div>
    <div class="stat">
      <div class="stat-value">${uniqueFiles}</div>
      <div class="stat-label">Files Affected</div>
    </div>
  </div>

  ${
    safeAiSummary
      ? `
  <div class="ai-section">
    <h2>AI Impact Analysis</h2>
    <div class="ai-summary">${safeAiSummary}</div>
  </div>
  `
      : ""
  }

  <div class="tree-section">
    <h2>Affected Dependencies</h2>
    ${treeHtml}
  </div>

  <div class="footer">
    <span>Generated by TRACECODE — tracecode v${VERSION}</span>
    <span>${safeTimestamp}</span>
  </div>
</div>
</body>
</html>`;
}

/**
 * Formats an ISO timestamp into a human-friendly string.
 * e.g. "2026-09-18T09:45:57.614Z" → "Sep 18, 2026 at 9:45 AM"
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return (
    date.toLocaleDateString("en-us", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) +
    " at " +
    date.toLocaleTimeString("en-us", { hour: "numeric", minute: "2-digit" })
  );
}

/**
 * Renders AI summary text as safe HTML.
 * Converts markdown fenced code blocks to <pre><code> and newlines to <br>.
 * HTML-escapes all content first for XSS safety.
 */
function renderMarkdown(text: string): string {
  let safe = escapeHtml(text);
  // Fenced code blocks: ```lang\n...\n``` → <pre><code class="lang">...</code></pre>
  safe = safe.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre><code class="$1">$2</code></pre>',
  );
  // Remaining newlines → <br>
  safe = safe.replace(/\n/g, "<br>");
  return safe;
}

/**
 * Returns a kind-specific icon for a dependent.
 * Since we don't have the kind in the Dependent interface,
 * we use a generic function icon.
 */
function getKindIcon(dep: Dependent): string {
  switch (dep.kind) {
    case "module":
      return "📄";
    case "function":
      return "ƒ";
    case "class":
      return "C";
    case "method":
      return "m";
    case "variable":
    case "const":
      return "V";
    case "interface":
      return "I";
    case "type":
      return "T";
    case "enum":
      return "E";
    default:
      return "ƒ";
  }
}
