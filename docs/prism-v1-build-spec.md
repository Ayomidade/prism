# TRACECODE v1 — Build Specification

This turns the PRD + Technical Architecture into the exact implementation contract for the frozen MVP (see `mvp-contract.md`): three commands, local-only by default, no AI or HTML export required to ship.

---

## 1. Folder Structure

```
tracecode/
├── src/
│   ├── cli/
│   │   ├── index.ts              # CLI entry point, command registration
│   │   ├── commands/
│   │   │   ├── init.ts
│   │   │   ├── why.ts
│   │   │   └── impact.ts
│   │   └── output/
│   │       ├── terminal.ts       # human-readable formatting
│   │       └── json.ts           # --json formatting
│   │
│   ├── ingestion/
│   │   ├── git/
│   │   │   ├── log.ts            # git log parsing
│   │   │   ├── blame.ts          # git blame parsing
│   │   │   └── rename-trace.ts   # follow file renames through history
│   │   └── github/
│   │       ├── client.ts         # GitHub API wrapper (optional, token-gated)
│   │       └── pr-issue-link.ts  # link commits → PRs/issues
│   │
│   ├── graph/
│   │   ├── parser.ts             # AST parsing (ts-morph)
│   │   ├── build-graph.ts        # construct nodes/edges from AST + git data
│   │   └── query.ts              # graph traversal (dependents, history lookup)
│   │
│   ├── store/
│   │   ├── schema.ts             # SQLite schema + migrations
│   │   ├── db.ts                 # connection/init logic
│   │   └── repository.ts         # read/write helpers for graph data
│   │
│   ├── summarize/
│   │   └── template.ts           # default no-AI "why" summary builder
│   │
│   └── config/
│       └── tokens.ts             # local token storage (keychain / config file)
│
├── test/
│   ├── fixtures/                 # small sample repos for integration tests
│   ├── unit/
│   └── integration/
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 2. Packages / Dependencies

| Purpose               | Package                                               |
| --------------------- | ----------------------------------------------------- |
| CLI framework         | `commander`                                           |
| AST parsing           | `ts-morph`                                            |
| SQLite                | `better-sqlite3`                                      |
| Terminal formatting   | `chalk` (color), `cli-table3` or custom tree renderer |
| GitHub API (optional) | `@octokit/rest`                                       |
| Testing               | `vitest`                                              |
| Build/bundling        | `tsup` or `esbuild` for a single-file CLI binary      |

No AI SDK is a required dependency for v1 — the Anthropic SDK is deferred to the fast-follow AI summarization feature and is not part of the v1 dependency tree.

---

## 3. Database Schema (SQLite)

```sql
-- files: one row per tracked file, current and historical path
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT 0
);

-- renames: tracks file path history for accurate blame across moves
CREATE TABLE file_renames (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id),
  old_path TEXT NOT NULL,
  commit_sha TEXT NOT NULL
);

-- symbols: functions/classes/exports within a file
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,        -- 'function' | 'class' | 'export' | 'variable'
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL
);

-- edges: dependency relationships between symbols (who calls/imports whom)
CREATE TABLE edges (
  id INTEGER PRIMARY KEY,
  from_symbol_id INTEGER NOT NULL REFERENCES symbols(id),
  to_symbol_id INTEGER NOT NULL REFERENCES symbols(id),
  edge_type TEXT NOT NULL    -- 'imports' | 'calls' | 'extends'
);

-- commits: raw commit metadata
CREATE TABLE commits (
  sha TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  date TEXT NOT NULL,
  message TEXT NOT NULL
);

-- commit_files: which files/line ranges a commit touched (from blame/diff)
CREATE TABLE commit_files (
  id INTEGER PRIMARY KEY,
  commit_sha TEXT NOT NULL REFERENCES commits(sha),
  file_id INTEGER NOT NULL REFERENCES files(id),
  start_line INTEGER,
  end_line INTEGER
);

-- pr_issue_links: optional, only populated if GitHub token provided
CREATE TABLE pr_issue_links (
  id INTEGER PRIMARY KEY,
  commit_sha TEXT NOT NULL REFERENCES commits(sha),
  pr_number INTEGER,
  issue_number INTEGER,
  title TEXT,
  body TEXT
);

-- meta: schema version + last index timestamp, for staleness checks
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

---

## 4. Graph Model

- **Node types:** `File`, `Symbol` (function/class/export/variable)
- **Edge types:** `imports` (file → file), `calls` (symbol → symbol), `extends` (class → class)
- **Directionality:** edges point from the _dependent_ to the _dependency_ (A imports B → edge A→B). `impact` queries traverse edges in reverse (who points _to_ this symbol) to find dependents.
- **Traversal for `impact`:** breadth-first from the target symbol, following reverse edges, capped at a configurable depth (default: unlimited, but de-duplicated to avoid cycles)
- **Traversal for `why`:** not a graph traversal — a direct lookup of `commit_files` rows overlapping the given file/line range, joined to `commits` and (optionally) `pr_issue_links`

---

## 5. CLI Commands (exact contract)

### `tracecode init`

```
tracecode init [--refresh]
```

- Detects git repo root, fails clearly if not inside one
- Parses full git log/blame history
- Parses all `.js/.ts/.jsx/.tsx` files via AST into the graph
- If a GitHub token is configured, fetches linked PR/issue data for recent commits
- Writes everything to `.tracecode/graph.db`
- `--refresh` forces a full re-index instead of using the existing cache

### `tracecode why`

```
tracecode why <file>:<line>
tracecode why --function <name>
tracecode why <file>:<line> --json
```

- Resolves the target symbol/line range
- Looks up overlapping commits, ordered most-recent first
- If PR/issue data exists for those commits, includes it
- Builds a template-based summary (default) tagged `confidence: documented`
- Fails clearly with "no significant history" if the code is new/unindexed, rather than fabricating an answer

### `tracecode impact`

```
tracecode impact <symbol>
tracecode impact <file>:<symbol>
tracecode impact <symbol> --json
```

- Resolves the symbol (disambiguates by file path if the name is ambiguous, prompts if still unclear)
- Traverses the reverse dependency graph
- Outputs a tree: direct dependents first, then transitive, grouped by file
- `--json` returns the same data as a flat list with a `depth` field per dependent

---

## 6. APIs

- **GitHub REST API** — only called during `init` (or `init --refresh`), only if a token is configured. Endpoints needed: list commits' associated PRs, fetch PR/issue title+body. Rate-limit aware (GitHub's standard rate limits), fails gracefully to "no PR/issue context available" if unauthenticated or rate-limited.
- **No other external API calls in v1** — Anthropic API integration is explicitly deferred past the v1 contract.

---

## 7. Indexing Pipeline (step-by-step)

1. Verify current directory is inside a git repo (`git rev-parse --show-toplevel`)
2. Run `git log --all --numstat --format=...` to get full commit history with file-level change stats
3. For each tracked source file, run `git blame` to map current lines back to the commit that introduced them, following renames via `git log --follow`
4. Parse each source file with `ts-morph` to extract symbols (functions, classes, exports) and their line ranges
5. Cross-reference blame data with symbol line ranges to populate `commit_files`
6. Parse import/call statements per file to build `edges`
7. If a GitHub token is present, batch-fetch PR/issue links for the commit SHAs collected in step 2 (capped to avoid rate-limit issues on very large histories, e.g. most recent N commits per file)
8. Write schema version + timestamp to `meta`

Incremental re-index (`--refresh` without full rebuild, post-v1 optimization): compare current git HEAD against the SHA stored in `meta`, only re-process files changed since then. **Not required for v1** — full re-index on every `init` is acceptable for the frozen MVP contract; incremental indexing is a fast-follow.

---

## 8. Error Handling

| Condition                                            | Behavior                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Not inside a git repo                                | Clear error, exit non-zero, no partial `.tracecode/` created                                              |
| Shallow clone (limited history)                      | Warn that history is incomplete, proceed with what's available                                            |
| No GitHub token configured                           | Silently skip PR/issue enrichment, `why` still works from commit messages alone                           |
| GitHub API rate-limited/unauthorized                 | Warn once, skip enrichment for remainder of run, don't fail the whole `init`                              |
| Symbol not found (`why`/`impact`)                    | Clear "not found" message, suggest closest match if available                                             |
| Ambiguous symbol name                                | List all matches with file paths, ask user to specify one                                                 |
| Corrupt/missing `.tracecode/graph.db`                | Detect on command run, instruct user to re-run `tracecode init`                                           |
| Schema version mismatch (upgraded TRACECODE version) | Detect via `meta`, instruct user to re-run `tracecode init --refresh`                                     |
| Very large repo (10k+ files)                         | No hard failure required for v1; acceptable to be slow. Performance optimization is post-v1, not blocking |

---

## 9. Development Sequence

This follows the existing `build-plan.md` phases, restated as an implementation order with explicit dependencies:

1. **SQLite schema + connection layer** (`store/schema.ts`, `store/db.ts`) — everything else depends on this existing first
2. **Git log/blame parsing** (`ingestion/git/`) — no dependency on the graph, can be built and tested standalone
3. **AST parsing + graph construction** (`graph/parser.ts`, `graph/build-graph.ts`) — depends on schema, not on git ingestion
4. **`tracecode init` command** — wires ingestion + graph construction + storage together, first fully working command
5. **`tracecode why` command** — depends on `init` having populated `commit_files`
6. **`tracecode impact` command** — depends on `init` having populated `edges`
7. **GitHub API enrichment** — bolted onto `init`, additive, doesn't block 4-6 from working without it
8. **Error handling pass** — applied across all commands once the happy path works
9. **Testing against real repos** — validates the whole pipeline end to end
10. **Package + publish** — only after 1-9 are solid

AI summarization and HTML export are intentionally absent from this sequence — they begin only after the v1 contract's definition of done (see `mvp-contract.md`) is met.
