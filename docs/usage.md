# PRISM Usage Guide

PRISM is a local-first CLI that indexes your git history and code structure so you can understand why code exists and what a change will break.

---

## Install

```bash
npm install -g prism-cli
```

Or run without installing:

```bash
npx prism-cli <command>
```

---

## Quick Start

```bash
# 1. Index your repo
cd my-project
prism init

# 2. Ask why code exists
prism why src/db.ts:42

# 3. See what would break
prism impact openDatabase
```

---

## Commands

### `prism init`

Indexes the current repository. Builds a local SQLite graph in `.prism/graph.db` from git history (log + blame) and AST parsing (imports, exports, functions, classes, call relationships).

```bash
prism init
prism init --refresh    # wipe existing index and rebuild from scratch
```

**What it does:**

1. Parses full git log history
2. Runs `git blame` on every tracked `.ts`, `.tsx`, `.js`, `.jsx` file
3. Parses AST to extract symbols and call/import relationships
4. Builds the dependency graph in SQLite
5. Optionally fetches GitHub PR/issue data (if a token is configured)

**Requires:** Inside a git repository.  
**Output:** `.prism/graph.db` (local, never leaves your machine).

---

### `prism why <file>:<line>`

Explains why a piece of code exists by looking up its commit history and summarizing the context.

```bash
prism why src/db.ts:42           # by file and line number
prism why --function openDatabase # by function name
prism why src/db.ts:42 --json     # JSON output
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[location]` | `file:line` format, e.g. `src/foo.ts:42` |

**Options:**

| Flag | Description |
|------|-------------|
| `--function <name>` | Look up by function name instead of file:line |
| `--json` | Output as JSON |

**Output includes:** commit history, authors, PR/issue links (if configured), and an AI-generated or template-based summary explaining the purpose of the code.

---

### `prism impact <symbol>`

Shows what could break if you change a symbol. Traverses the reverse dependency graph to find direct and transitive dependents.

```bash
prism impact openDatabase                  # by symbol name
prism impact src/db.ts:openDatabase        # disambiguate with file prefix
prism impact openDatabase --json           # JSON output
prism impact openDatabase --html           # HTML report (writes impact-report.html)
prism impact openDatabase --html report.html  # HTML report to custom path
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<symbol>` | Symbol name, or `file:symbol` to disambiguate when the same name exists in multiple files |

**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--html [path]` | Export as a standalone HTML report. Default path: `impact-report.html` |

**Terminal output example:**

```
Impact of changing src/store/db.ts:openDatabase:

src/cli/commands/impact.ts
  registerImpactCommand
src/cli/commands/why.ts
  registerWhyCommand
src/cli/index.ts
    src/cli/index.ts (top-level code)
src/ingestion/db-write.ts
  src/ingestion/db-write.ts (top-level code)
src/ingestion/github-fetch.ts
  src/ingestion/github-fetch.ts (top-level code)
src/ingestion/graph-load.ts
  src/ingestion/graph-load.ts (top-level code)

6 dependents found.
```

---

## Configuring AI Summarization

PRISM supports multiple AI providers for richer `why` summaries. If no AI key is configured, it falls back to a template-based summarizer (no key needed).

### Supported Providers

| Provider | Key Environment Variable | Default Model |
|----------|--------------------------|---------------|
| Anthropic | `PRISM_ANTHROPIC_KEY` | `claude-sonnet-4-20250514` |
| OpenAI | `PRISM_OPENAI_KEY` | `gpt-4o-mini` |
| Google Gemini | `PRISM_GEMINI_KEY` | `gemini-2.0-flash` |
| Groq | `PRISM_GROQ_KEY` | `llama-3.3-70b-versatile` |
| Custom (OpenRouter, Ollama, etc.) | `PRISM_CUSTOM_KEY` | (must set `PRISM_AI_MODEL`) |

### Setting an API Key

Set via environment variable (temporary):

```bash
export PRISM_ANTHROPIC_KEY="sk-ant-..."
prism why src/db.ts:42
```

Or store permanently with the config command (written to `~/.config/prism/<provider>-key` with mode `0600`):

```bash
prism config set-key anthropic sk-ant-...
prism config set-key openai sk-...
prism config set-key github ghp_...
```

To check what's stored, look in `~/.config/prism/`. To remove a key, delete the file:

```bash
rm ~/.config/prism/anthropic-key
```

### Selecting a Provider

PRISM auto-detects which provider to use based on which keys are configured, in this order:

1. Anthropic
2. OpenAI
3. Gemini
4. Groq
5. Custom

To force a specific provider, set `PRISM_AI_PROVIDER`:

```bash
export PRISM_AI_PROVIDER=openai
export PRISM_OPENAI_KEY="sk-..."
prism why src/db.ts:42
```

If you set `PRISM_AI_PROVIDER` but haven't configured that provider's key, PRISM will error with an actionable message.

### Overriding the Model

```bash
export PRISM_AI_MODEL="gpt-4o"
prism why src/db.ts:42
```

### Using a Custom Endpoint

For OpenRouter, Ollama, or any OpenAI-compatible API:

```bash
export PRISM_AI_PROVIDER=custom
export PRISM_CUSTOM_KEY="your-api-key"
export PRISM_AI_BASE_URL="https://openrouter.ai/api/v1"
export PRISM_AI_MODEL="meta-llama/llama-3.1-8b-instruct"
prism why src/db.ts:42
```

---

## Configuring GitHub Enrichment

When a GitHub token is provided, `prism init` fetches linked PR and issue data for your commit history. This enriches `why` output with PR numbers and titles.

### Setting a GitHub Token

Set via environment variable:

```bash
export PRISM_GITHUB_TOKEN="ghp_..."
prism init
```

Or store permanently with the config command:

```bash
prism config set-key github ghp_...
```

**Required scope:** `repo` (read-only access to pull requests).

### Overriding Owner/Repo

If your git remote doesn't match your GitHub repo, or you're working with a fork:

```bash
export PRISM_GITHUB_OWNER="acme-corp"
export PRISM_GITHUB_REPO="my-app"
prism init
```

---

## Output Formats

### Terminal (default)

Human-readable, color-free text. `why` prints a summary with commit history. `impact` prints a tree grouped by file with depth indentation.

### JSON (`--json`)

Machine-readable JSON. Useful for piping into other tools or building custom workflows.

```bash
prism why src/db.ts:42 --json | jq '.confidence'
prism impact openDatabase --json | jq '.dependents | length'
```

**Why JSON shape:**

```json
{
  "target": "src/db.ts:42",
  "confidence": "documented",
  "commitCount": 5,
  "history": [
    {
      "commitSha": "abc123...",
      "message": "Add schema version check",
      "date": "2026-09-10T09:00:00Z",
      "author": "Alice",
      "prNumbers": [42],
      "prTitles": ["Add schema validation"]
    }
  ],
  "aiSummary": "This function..."
}
```

**Impact JSON shape:**

```json
{
  "target": "src/db.ts:openDatabase",
  "dependents": [
    {
      "file": "src/cli/commands/why.ts",
      "symbol": "openDatabase",
      "kind": "function",
      "depth": 1
    }
  ]
}
```

### HTML (`--html`, impact only)

Generates a self-contained responsive HTML report with no external dependencies. Open it in any browser.

```bash
prism impact openDatabase --html                # writes impact-report.html
prism impact openDatabase --html my-report.html # custom path
```

---

## Environment Variables Reference

| Variable | Purpose |
|----------|---------|
| `PRISM_GITHUB_TOKEN` | GitHub personal access token (read-only `repo` scope) |
| `PRISM_GITHUB_OWNER` | Override GitHub owner for API calls |
| `PRISM_GITHUB_REPO` | Override GitHub repo name for API calls |
| `PRISM_AI_PROVIDER` | Force AI provider: `anthropic`, `openai`, `gemini`, `groq`, `custom` |
| `PRISM_ANTHROPIC_KEY` | Anthropic API key |
| `PRISM_OPENAI_KEY` | OpenAI API key |
| `PRISM_GEMINI_KEY` | Google Gemini API key |
| `PRISM_GROQ_KEY` | Groq API key |
| `PRISM_CUSTOM_KEY` | Custom provider API key |
| `PRISM_AI_MODEL` | Override model for any provider |
| `PRISM_AI_BASE_URL` | Base URL for custom provider |

---

## How It Works

PRISM stores everything locally in `.prism/graph.db`. Nothing leaves your machine unless you configure an AI provider or GitHub token.

```
prism init
  |
  v
git log + git blame  ──>  SQLite DB  <──  AST parser (ts-morph)
                             |
    .prism/graph.db          |
  ┌──────────────────────────┤
  │ files                    │
  │ symbols                  │
  │ edges (calls, imports)   │
  │ commits                  │
  │ commit_files             │
  │ pr_issue_links (opt.)    │
  └──────────────────────────┘
                             |
              ┌──────────────┴──────────────┐
              v                             v
        prism why                    prism impact
   (history + summary)          (dependency traversal)
```

---

## Troubleshooting

**"Not inside a git repository."**  
Run `prism init` from inside a git repo.

**"No indexed data found. Run `prism init` first."**  
The `.prism/graph.db` file doesn't exist. Run `prism init` in the repo.

**"Error: Invalid location format"**  
Use `file:line` format, e.g. `src/foo.ts:42`.

**"Error: Symbol 'X' is ambiguous."**  
The same symbol name exists in multiple files. Use `file:symbol` format, e.g. `src/db.ts:openDatabase`.

**Shallow clone warning**  
PRISM works with shallow clones but history will be incomplete. Run `git fetch --unshallow` for full history.

**AI summarization falls back to template**  
No AI key is configured. Set one of the provider keys (see [Configuring AI Summarization](#configuring-ai-summarization)).

**`impact` shows "No dependents" for a symbol that's clearly used**  
PRISM's call graph only tracks function/method *calls* (`foo()`), not value references (`foo` used as a variable, passed as an argument, or used in a template literal). If a symbol is referenced as a value rather than called, `impact` won't see it. This is a v1 scope cut — full type-checker resolution is out of scope.

**`db.close()` crash**  
PRISM removed all `db.close()` calls to avoid a known better-sqlite3 crash during Node.js process teardown. If you see this error, update to the latest version.
