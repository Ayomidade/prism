# PRISM

**Understand your codebase before you change it.**

A local-first CLI for JS/TS developers. PRISM indexes your repo's git history and code structure once, then answers two questions straight from your terminal:

- **`prism why <file>:<line>`** — why does this code exist?
- **`prism impact <symbol>`** — what will changing this break?

No code leaves your machine. No server, no account, no cloud dependency required.

---

## Status

🚧 **Phase 1, Day 2 complete.** Git ingestion (log + blame) and the SQLite persistence layer are implemented and tested. The store layer (`db.ts`, `schema.ts`, `repository.ts`) is fully working with schema versioning and dedup. See `linking.md` for a detailed build log of what was done, bugs encountered, and lessons learned.

**Next up:** Day 3 — AST parsing + code graph construction (`graph/parser.ts`, `graph/build-graph.ts`).

## Planning Docs

Read in this order:

1. [`docs/problem-brief.md`](./docs/problem-brief.md) — problem, research, competitive landscape
2. [`docs/prd.md`](./docs/prd.md) — product requirements
3. [`docs/technical-architecture.md`](./docs/technical-architecture.md) — stack decisions, data flow, security
4. [`docs/mvp-contract.md`](./docs/mvp-contract.md) — the frozen v1 scope, read this before touching code
5. [`docs/prism-v1-build-spec.md`](./docs/prism-v1-build-spec.md) — exact implementation contract: schema, graph model, commands, dev sequence
6. [`docs/build-plan.md`](./docs/build-plan.md) — day-by-day task breakdown

## Quick Start (once implemented)

```bash
npm install
npm run dev -- init          # index the current repo
npm run dev -- why src/foo.ts:42
npm run dev -- impact User.email
```

## Development

```bash
npm install       # install dependencies
npm run dev        # run the CLI in dev mode via tsx
npm run build       # bundle to dist/ for publishing
npm test           # run vitest
npm run typecheck    # tsc --noEmit
```

### Native module rebuild

`better-sqlite3` ships a native C/C++ binary. If you switch Node versions (via nvm, fnm, or a different machine) after `npm install`, you'll see errors like `NODE_MODULE_VERSION 127 ... requires NODE_MODULE_VERSION 137`. Fix is always:

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
└── config/           # local token storage (GitHub token, etc.)
```

Every module maps directly to a section of `docs/prism-v1-build-spec.md` — check there before implementing any file.

## Scope

v1 is exactly three commands: `init`, `why`, `impact`. No AI, no HTML export, no VS Code extension, no runtime tracing. See `docs/mvp-contract.md` for the frozen definition of done.

## License

TBD
