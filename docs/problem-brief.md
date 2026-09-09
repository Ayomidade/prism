# Problem Brief: Codebase Intelligence Tool

## 1. Problem Definition

**Who has the problem?**
Backend/full-stack developers joining an existing codebase — new hires, freelancers/contractors, or the original author returning to old code after months away.

**What exactly are they struggling with?**
Two distinct pain points that compound each other:
- Reading code tells you *what* it does, never *why* it exists that way (a weird retry, a magic number, a defensive null check)
- Making a change to shared code (a model field, a shared function) means manually tracing every place that touches it, which is slow and error-prone

**When does it happen?**
Onboarding to a new repo, inheriting legacy code, reviewing a PR that touches shared code, or returning to your own code after enough time that you no longer remember your own reasoning.

**How are they solving it today?**
`git blame` plus guessing, asking a teammate who may have left, reading old PR/issue threads manually, grepping for usages by hand, or just making the change and seeing what breaks in CI/staging.

**Why are current solutions inadequate?**
Git blame gives you *who* and *when*, never *why*. Grep-based usage search misses indirect calls and doesn't rank what actually matters. Asking a teammate doesn't scale and depends on someone remembering.

**How painful/frequent is the problem?**
Near-daily for anyone working in a codebase older than a few months; sharp pain (hours lost) whenever it happens.

**What happens if they don't solve it?**
Wasted time re-deriving context, accidental regressions from unseen dependents, and knowledge that quietly leaves with whoever wrote the code.

---

## 2. Existing Solutions Research

### "Why does this exist" space
(Crowded, mostly CLI, npm/PyPI, all fresh 2026 projects)

- **git-why** — analyzes git blame, commit messages, and diffs, then uses AI to explain the reasoning behind the code, turning raw git history into a human-readable narrative. Requires an Anthropic API key.
- **git-unearth** — a git blame enhancer that traces commit → PR → Issue → business context, and assigns confidence levels (documented / clear commit / AI inference) to its explanations.
- **GitMind** — a multi-agent CLI that reads repository history, traces commits to PRs and issues, and can even recover lost work.
- **Academic validation** — a recent research system extracts and organizes GitHub PR/issue artifacts hierarchically to explain not just what code does but why it exists; user studies found the explanations generally helpful and free from hallucinations.

### "What will this break" space
(Also crowded, more enterprise-leaning)

- **Nodestradamus** — an MCP server and Python library that builds a dependency graph of who-calls-what and answers "what breaks if I change this?" before refactors.
- **ops-codegraph-tool** — a function-level dependency graph across 34 languages with git-diff impact analysis and CODEOWNERS mapping, fully local with no API keys.
- **Greptile** (AI code review) — does cross-file impact analysis tracing the full stack of changed functions to identify callers and dependencies, but doesn't track external API consumers or cross-repository breaking changes.
- A VS Code extension exists specifically for Python that parses files with tree-sitter and resolves calls via a language server to show how a change propagates.

### Indirect alternatives
Sourcegraph/code search tools (find usages but no "why"), Swimm (manual documentation, not automatic), plain `git log -p` + grep, IDE "find references."

### What users like
Local-only/no-API-key options (trust, no code leaving the machine), confidence scoring instead of blind AI claims, CI/PR-comment integration.

### What users dislike / what tools completely fail to solve
- Almost everything found is **single-purpose** — a "why" tool OR an "impact" tool, never both on one shared graph.
- Most "why" tools need an API key and send code to an LLM; almost none is JS/Node-native (most are Python-CLI or npm-thin-wrapper).
- Impact tools are mostly built for enterprise (multi-language, MCP servers for AI agents) — few are aimed at a solo dev or small team wanting a quick answer.
- None found combine git history *and* dependency graph into one **queryable index** — they rebuild context per-query instead of indexing once.

### Opportunity Gap
A single local-first engine, JS/Node-native, that indexes a repo once and answers both "why" and "what breaks" from the same graph — positioned for individual developers and small teams, not enterprise MCP infrastructure.

---

## 3. Solution Definition

> For a **developer inheriting or maintaining an existing JS/TS codebase**, who struggles with **not knowing why code was written a certain way and what a change will break**, we are building **PRISM**, a local-first CLI tool that **indexes git history, PRs/issues, and code structure once, then answers both "why does this exist" and "what will this break" from that same index**. Unlike single-purpose tools like git-why (why-only) or Nodestradamus (impact-only), it **unifies both questions on one graph, runs entirely locally by default, and is built for individual JS/TS developers rather than enterprise multi-language setups**.

---

## 4. MVP Scope

### 🔴 Must have
- Repo ingestion: parse git log/blame + local commit metadata into a graph
- "Why does this exist": query by function/file, return commit history + linked PR/issue text (GitHub API) summarized
- "What will this break": query by symbol, return static usage/import graph (callers, importers)
- CLI output that's actually readable (colored, structured, not a JSON dump)

### 🟡 Should have
- Confidence indicator on "why" answers (documented vs inferred)
- HTML/web report export for the dependency graph (frontend portfolio piece)
- JSON output mode for scripting/CI

### 🟢 Nice to have
- GitHub Action / PR comment integration
- VS Code extension wrapping the same engine
- "Why doesn't this run" environment diagnostics
- Runtime error tracing (needs live logs, out of scope for v1)
