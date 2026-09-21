# Technical Architecture

## TRACECODE — Codebase Intelligence Tool

---

## 1. Frontend

There is no traditional web frontend for the MVP, the primary interface is the terminal.

- **CLI output:** Node.js CLI with structured, colored terminal output (tables/trees for `impact`, formatted text blocks for `why`)
- **HTML report (should-have):** a single self-contained static HTML file generated locally, no server required. Built with plain HTML/CSS/JS plus a lightweight graph-rendering library, embedded directly in the generated file so it opens standalone in any browser
- **Responsiveness:** the HTML report must be fully responsive across all screen sizes (mobile, tablet, desktop), since it may be opened or shared on any device
- **Post-MVP:** VS Code extension frontend (webview panel), reusing the same underlying engine

---

## 2. Backend

There is no always-on server for the MVP. The "backend" is the local Node.js/TypeScript engine that runs on the developer's machine:

- **Ingestion engine:** shells out to native `git` (log, blame, diff) and parses output into structured commit/history data
- **Code graph engine:** AST-based parser for JS/TS (e.g. `@typescript-eslint/typescript-estree` or `ts-morph`) to resolve imports, exports, and function/symbol usage into a call graph
- **Query engine:** reads the locally stored graph and answers `why` and `impact` queries
- **Summarization layer:** optional, pluggable module that formats commit/PR/issue text into a narrative, either via a template-based fallback or via an AI call (see Section 6)

**Post-MVP consideration:** if a hosted/SaaS version is ever built, this engine becomes a background worker behind a thin API layer, but that is explicitly out of scope for MVP (see PRD Section 13).

---

## 3. Database

- **Local embedded database: SQLite**, stored inside the repo (e.g. `.tracecode/graph.db`) or in a user-level cache directory
- Stores: parsed commit history, code structure graph (nodes = files/functions/symbols, edges = imports/calls), and cached PR/issue text
- Chosen over a hosted DB because the tool is local-first — no server, no per-user database to manage, and it keeps repeat queries fast without re-parsing the whole repo
- Schema is versioned so future `init --refresh` runs can detect stale caches and re-index incrementally rather than fully

---

## 4. APIs

- **GitHub REST API** (read-only) — used to fetch PRs and issues linked to commits, to enrich `why` answers with business context. Optional: works only if the user provides a token
- **Anthropic API** (optional) — used only if the user opts into AI-assisted summarization instead of the template-based fallback
- **No internal API server** for MVP — all "API" calls are outbound from the local CLI process, there is nothing to host or version for the MVP itself

---

## 5. Authentication

- **No user accounts / no login system** for the MVP — this is a local CLI tool, not a multi-tenant SaaS
- **GitHub token:** a personal access token (read-only scope: `repo` read or fine-grained read-only) provided by the user, stored locally via the OS keychain where available, or a local config file excluded from git via `.gitignore`
- **AI API key:** if the user opts into AI summarization, their own Anthropic API key is stored the same way (OS keychain / local config), never transmitted anywhere except directly to Anthropic's API
- Both tokens are strictly optional; the tool must work with neither present

---

## 6. AI / Models

AI is an **enhancement, not a dependency**:

- **Default (no AI):** `why` answers are built from a template that assembles raw commit messages, PR titles/descriptions, and issue text into a readable but non-generative summary, tagged as "documented" confidence
- **Optional AI mode:** if the user supplies an Anthropic API key, commit/PR/issue text is passed to a Claude model to generate a natural-language explanation, tagged as "AI-inferred" confidence to distinguish it from directly-documented fact
- This mirrors what users explicitly said they liked in competitor research (confidence scoring instead of blind AI claims) and avoids forcing every user to have an API key just to use the core tool

---

## 7. Third-Party Services

- **GitHub API** — PR/issue context (optional, user-provided token)
- **Anthropic API** — optional AI summarization (user-provided key)
- **npm registry** — distribution of the CLI package itself
- No other third-party services required for MVP (no hosting provider, no analytics service, no auth provider)

---

## 8. Data Flow

```
git repo (local)
   │
   ▼
[init command]
   │
   ├── git log/blame/diff  ──────────► Commit history parser
   ├── source files (AST parse) ─────► Code graph builder (imports/calls)
   └── GitHub API (optional) ────────► PR/issue fetcher
   │
   ▼
Local SQLite graph store
   │
   ▼
[why / impact command]
   │
   ├── why: query commit history + PR/issue text
   │         └── optional: pass to Claude API for narrative summary
   │
   └── impact: query dependency graph for callers/importers
   │
   ▼
Output layer
   ├── terminal (default, human-readable)
   ├── --json (scripting/CI)
   └── --html (standalone responsive report)
```

---

## 9. Deployment

- **Distribution only, no hosting:** published as an npm package, run via `npx tracecode` or a global/local install
- **No servers to deploy or maintain** for the MVP, since all execution happens on the user's own machine
- **CI for the project itself:** GitHub Actions to run tests and publish to npm on tagged releases
- **Versioning:** semantic versioning, with the SQLite schema version checked on startup so users on an old cache get a clear "please re-run init" message rather than a silent failure

---

## 10. Security Considerations

- **No code ever leaves the machine by default** — this is the core trust promise, and it must hold even if AI mode is enabled for one query (only the specific commit/PR/issue text needed for that query is sent, never the full codebase)
- **Tokens stored locally only**, via OS keychain where available, excluded from any generated output (HTML export must never embed a raw token)
- **HTML export sanitization** — commit messages, PR titles, and file paths are user-controlled/repo-controlled strings; escape all of them before injecting into the generated HTML to avoid stored XSS if a report is ever shared or hosted
- **Read-only scopes only** — GitHub token permissions requested/documented as read-only, the tool never writes to the repo or GitHub
- **No telemetry by default** — if usage analytics are ever added post-MVP, they must be opt-in and clearly disclosed, consistent with the local-first trust story
