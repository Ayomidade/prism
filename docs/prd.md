# Product Requirements Document (PRD)
## PRISM — Codebase Intelligence Tool

---

## 1. Product Overview

A local-first CLI tool for JS/TS developers that indexes a repository's git history, PR/issue context, and code structure once into a single graph, then answers two recurring developer questions from that same index:

1. **"Why does this code exist?"** — surfaces the commit history, linked PRs/issues, and reasoning behind a function or file
2. **"What will this change break?"** — surfaces the dependency graph of callers/importers before a change is made

The tool runs locally by default (no code leaves the machine unless the user opts into AI-assisted summarization), and is aimed at individual developers and small teams rather than enterprise multi-language infrastructure.

---

## 2. Problem

Developers inheriting or maintaining an existing codebase struggle with two compounding issues: code tells you *what* it does but never *why* it was written that way, and changing shared code requires manually tracing every dependent, which is slow and error-prone. Existing tools solve one of these problems in isolation (git-why, git-unearth for "why"; Nodestradamus, ops-codegraph-tool for "impact") but none combine both on one shared index, and most "why" tools require sending code to a third-party LLM API. See the [Problem Brief](./problem-brief.md) for full research and competitive analysis.

---

## 3. Target Users

- **Primary:** Individual JS/TS backend or full-stack developers working in a codebase older than a few months (their own or inherited)
- **Secondary:** Small dev teams (2-10 engineers) without dedicated documentation practices
- **Tertiary:** Freelancers/contractors onboarding into unfamiliar client codebases quickly

---

## 4. Goals

- Give a developer a clear, sourced answer to "why does this exist" in under 10 seconds per query
- Give a developer a complete list of dependents before they change a shared symbol, reducing accidental regressions
- Run entirely on local data by default, so developers can trust it with private/proprietary code
- Ship as a real, usable npm package (portfolio credibility: actual installs/usage, not just a demo)

---

## 5. User Stories

- As a developer, I want to run a command against a function so that I can see why it was written the way it is, without reading raw `git log`.
- As a developer, I want to see linked PR/issue context for a piece of code so that I understand the business reason behind it, not just the commit message.
- As a developer, I want to query a symbol (e.g. `User.email`) before I change it so that I can see every file, function, and test that depends on it.
- As a developer, I want confidence levels on "why" answers so that I know whether the explanation is documented fact or AI inference.
- As a developer, I want JSON output so that I can pipe results into CI or my own scripts.
- As a team lead, I want to export a dependency report as HTML so that I can share it with teammates without asking them to install anything.

---

## 6. Core Workflows

**Workflow A — Ingest a repo**
1. Developer runs `prism init` inside a git repo
2. Tool parses git log/blame locally, builds a code structure graph (imports/exports/calls), optionally pulls linked PRs/issues via GitHub API
3. Tool stores the graph locally (e.g. SQLite) for fast repeat queries

**Workflow B — "Why does this exist"**
1. Developer runs `prism why <file>:<line>` or `prism why --function <name>`
2. Tool retrieves commit history for that code region from the graph
3. Tool summarizes commit messages + linked PR/issue text into a short explanation, tagged with a confidence level
4. Output printed to terminal (or `--json`)

**Workflow C — "What will this break"**
1. Developer runs `prism impact <symbol>`
2. Tool queries the dependency graph for direct and indirect callers/importers
3. Tool prints a tree of affected files/functions/tests, optionally exports as HTML

---

## 7. Functional Requirements

- FR1: Parse local git history (log, blame, diffs) without requiring network access
- FR2: Build a static import/call graph for JS/TS files
- FR3: Optionally fetch linked PRs/issues from GitHub via API (requires token, opt-in)
- FR4: Summarize commit/PR/issue text into a human-readable "why" explanation
- FR5: Tag each "why" explanation with a confidence level (documented / inferred)
- FR6: Query the dependency graph for all direct and transitive dependents of a given symbol
- FR7: Output results in both human-readable terminal format and `--json`
- FR8: Export dependency graph results as a standalone HTML report
- FR9: Persist the indexed graph locally so repeat queries don't re-parse the full repo

---

## 8. MVP Features

🔴 **Must have**
- `init` command: local git + code structure ingestion
- `why` command: commit history + PR/issue summary
- `impact` command: dependency/usage graph query
- Readable terminal output

🟡 **Should have**
- Confidence indicator on `why` output
- HTML export for `impact` results
- `--json` output mode

🟢 **Nice to have**
- GitHub Action / PR comment integration
- VS Code extension
- Environment/setup diagnostics ("why doesn't this run")
- Runtime error tracing

---

## 9. Non-Functional Requirements

- **Performance:** Initial ingestion of a medium repo (~500 files) completes in under 2 minutes; repeat queries return in under 2 seconds
- **Privacy:** No code or history leaves the local machine unless the user explicitly enables a remote AI summarization feature
- **Portability:** Works cross-platform (macOS, Linux, Windows) via Node.js
- **Reliability:** Ingestion must not crash on malformed/partial git histories; fails gracefully with a clear error
- **Usability:** Zero-config default (`npx prism init` and go); no required setup beyond having git installed
- **Responsiveness:** Any HTML/web report output must be fully responsive across all screen sizes

---

## 10. Edge Cases

- Repo with no git history (shallow clone) — tool should detect and warn, not crash
- Symbol/function with the same name in multiple files — disambiguate by path or prompt user
- Function that was recently added (no meaningful history yet) — return "no significant history" rather than a fabricated explanation
- Very large repos (10k+ files) — ingestion should be incremental/cacheable, not full re-parse every run
- Renamed/moved files — git history should still be traced through renames where possible
- No GitHub token provided — "why" should still work from commit messages alone, just without PR/issue context
- Monorepos with multiple package.json files — impact graph should respect package boundaries

---

## 11. Success Metrics

- Number of real npm installs / weekly downloads post-launch
- GitHub stars / issues opened (signal of real usage and engagement)
- Time-to-answer for a `why` or `impact` query (target: under 10 seconds including cold ingestion cache)
- Qualitative: unsolicited feedback/testimonials from developers who used it on a real repo
- Portfolio metric: usable as a concrete case study (problem → research → build → real users) in interviews

---

## 12. Technical Considerations

- **Language/runtime:** Node.js/TypeScript CLI, consistent with existing MERN stack experience
- **Git parsing:** shell out to native `git` commands (log, blame, diff) rather than reimplementing git internals
- **Code graph parsing:** AST-based parsing (e.g. via a JS/TS parser) for accurate import/call resolution, not regex
- **Storage:** local embedded database (e.g. SQLite) for the indexed graph, avoiding any server dependency
- **AI summarization:** optional, pluggable — must work without an API key using raw commit/PR text as a fallback
- **GitHub integration:** read-only API token, clearly scoped and optional
- **Distribution:** published as an npm package, runnable via `npx` with no global install required

---

## 13. Out-of-Scope Features (for MVP)

- Runtime error tracing / log ingestion ("what happened to this user")
- Multi-language support beyond JS/TS
- Hosted/SaaS version with OAuth-based repo access
- Real-time IDE integration (VS Code extension is a post-MVP stretch)
- Cross-repository/microservice dependency tracking
- Automated fixing of environment/setup issues
