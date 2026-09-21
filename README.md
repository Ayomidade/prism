# TRACECODE

**Understand your codebase before you change it.**

A local-first CLI for JS/TS developers. TRACECODE indexes your repo's git history and code structure, then answers two questions straight from your terminal:

- **`tracecode why <file>:<line>`** — why does this code exist?
- **`tracecode impact <symbol>`** — what will changing this break?

No code leaves your machine. No server, no account, no cloud dependency required.

---

## Install

```bash
npm install -g tracecode
```

Or run without installing:

```bash
npx tracecode <command>
```

## Quick Start

```bash
cd my-project
tracecode init                          # index the repo
tracecode why src/db.ts:42              # explain why this code exists
tracecode impact openDatabase           # see what would break
```

**Full usage guide:** [`docs/usage.md`](./docs/usage.md) — all commands, flags, AI provider setup, GitHub enrichment, output formats, and troubleshooting.

---

## Commands

| Command                                   | Description                                         |
| ----------------------------------------- | --------------------------------------------------- |
| `tracecode init`                          | Index the repository (git history + code structure) |
| `tracecode why <file>:<line>`             | Explain why a piece of code exists                  |
| `tracecode impact <symbol>`               | Show what could break if a symbol changes           |
| `tracecode config set-key <target> <key>` | Store API keys and tokens locally                   |

---

## Development

```bash
npm install          # install dependencies
npm run dev          # run the CLI in dev mode via tsx
npm run build        # bundle to dist/ for publishing
npm test             # run all tests (unit + integration)
npm run typecheck    # tsc --noEmit
```

### Running Tests

```bash
npm test                        # all tests
npx vitest run test/unit/       # unit tests only (fast)
npx vitest run test/integration/ # integration test (~30s)
npm run test:watch              # watch mode
```

### Native module rebuild

`better-sqlite3` ships a native C/C++ binary. If you switch Node versions after `npm install`, you'll see errors like `NODE_MODULE_VERSION 127 ... requires NODE_MODULE_VERSION 137`. Fix:

```bash
npm rebuild better-sqlite3
```

## Project Structure

```
src/
├── cli/            # command entry point, command handlers, output formatting
├── ingestion/       # git log/blame parsing, optional GitHub PR/issue fetching
├── graph/           # AST parsing + dependency graph construction/query
├── store/           # SQLite schema, connection, repository layer
├── summarize/        # template-based "why" summary builder (no AI required)
└── config/           # local token storage (GitHub token, AI provider keys)
```

## Scope

v1 ships four commands: `init`, `why`, `impact`, `config`. Includes multi-provider AI summarization (Anthropic, OpenAI, Gemini, Groq, custom endpoints), standalone HTML report export, and GitHub PR/issue enrichment. See [`docs/usage.md`](./docs/usage.md) for the full feature set.

## License

MIT — see [LICENSE](LICENSE) for details.
