# Build Log (linking.md)

## What Was Done

### Day 2 — Git ingestion + SQLite persistence

| Module | File | What it does |
|--------|------|-------------|
| Git log parser | `src/ingestion/git/log.ts` | `parseGitLog()` — shells out to `git log`, returns structured `ParsedCommit[]` |
| Git blame parser | `src/ingestion/git/blame.ts` | `parseGitBlame()` — shells out to `git blame --porcelain`, returns line→SHA mapping |
| Schema v2 | `src/store/schema.ts` | Added unique index on `files.path`, bumped version to `"2"` |
| Repository | `src/store/repository.ts` | `insertFile`, `insertCommit`, `insertSymbol`, `insertEdge` — all working with dedup |
| Tests | `test/unit/blame.test.ts`, `test/unit/repository.test.ts` | 15 new tests across both files |

### Day 3 — AST parsing + code graph

| Module | File | What it does |
|--------|------|-------------|
| AST parser | `src/graph/parser.ts` | `parseSourceFile()` — uses ts-morph to extract symbols + relative imports |
| Graph builder | `src/graph/build-graph.ts` | `buildGraph()` — inserts module symbols + import edges into SQLite |
| Tests | `test/unit/parser.test.ts`, `test/unit/build-graph.test.ts` | 13 new tests across both files |
  
**Test suite: 39/39 passing, typecheck clean.**

---

## How It Was Done

### 1. Git Command

Ran `git log --all --numstat` with a custom `--format` string using control-character separators:

- `\x1e` (Record Separator) — marks the end of each commit header
- `\x1f` (Unit Separator) — separates fields within the header (SHA, author, date, message)

These characters were chosen because they **cannot appear in normal commit text** — zero collision risk, unlike literal strings like `---COMMIT_SEP---`.

Format string: `%H\x1f%an\x1f%aI\x1f%s\x1e`

### 2. maxBuffer

Set `execSync`'s `maxBuffer` to **100MB** (`100 * 1024 * 1024`). The default is 1MB, which silently works on small repos and then throws `ENOBUFS` on any real project with meaningful history. This was caught during planning before it could bite in production.

### 3. Line-by-Line Parser

Initially tried splitting on `\x1e` and treating each block as a self-contained commit. This was **wrong** — git's output structure is:

```
<header>\x1e\n
\n
<numstat lines>\n
<header>\x1e\n
\n
<numstat lines>\n
```

The `\x1e` comes **after** the header but **before** the numstat. So splitting on `\x1e` produces blocks where the numstat for commit N lives in the same block as the header for commit N+1.

**Fix:** Process lines sequentially. Detect header lines by the presence of `\x1f`, accumulate numstat lines between headers, finalize each commit when the next header is encountered.

### 4. Edge Cases Handled

| Case | How |
|------|-----|
| Merge commits (2+ parents) | No numstat produced by git — `filesChanged` stays `[]` |
| Root commits (0 parents) | Normal case — git diffs against empty tree automatically |
| Binary files | numstat shows `-` for additions/deletions — mapped to `0` |
| Empty repos | `git log` returns empty output or throws — returns `[]` |
| Malformed lines | Skipped (header with < 4 fields, numstat with < 3 tab-separated parts) |

---

## Issues Encountered

### Issue 1: `tsx -e` doesn't support top-level await

**What happened:** Running `npx tsx -e "import { parseGitLog } from '...'; const commits = await parseGitLog('.');"` threw `Top-level await is currently not supported with the "cjs" output format`.

**Why:** `tsx`'s `-e` (eval) flag transpiles to CommonJS format by default, which doesn't support top-level `await`.

**Fix:** Wrapped the test in an async IIFE: `(async () => { ... })();`

**Lesson:** When testing ESM modules with `tsx -e`, always wrap async code in an IIFE.

### Issue 2: Block splitting gave wrong commit counts

**What happened:** First test returned only 1 commit when there are 7 in the repo.

**Root cause:** The `\x1e` record separator appears right after the commit header in git's output, but the numstat lines come **after** the `\x1e`. Splitting on `\x1e` and treating each block as a complete commit meant:
- Block 0: header only (no numstat)
- Block 1: numstat for commit 0 + header for commit 1
- Block 2: numstat for commit 1 + header for commit 2
- ...

The parser saw 8 blocks (7 commits + trailing empty), but the filter logic and header detection were confused by the interleaved structure.

**Debugging steps:**
1. Added character-level analysis of the raw output to map separator positions
2. Discovered 7 `\x1e` characters but the split produced 8 blocks
3. Inspected block contents — confirmed numstat was in the wrong block
4. Rewrote parser to process lines sequentially instead of splitting on separators

**Fix:** Replaced block-split approach with a stateful line-by-line parser:
- When a line contains `\x1f` → it's a header → finalize previous commit, start new one
- Otherwise → it's a numstat line → accumulate into current commit's `filesChanged`
- Blank lines between header and numstat → skipped

**Lesson:** Control-character separators work well for delimiting records, but you must understand the **exact output structure** of the command you're parsing. The separator is part of the format string, not a delimiter between self-contained blocks.

### Issue 3: `execSync` module resolution in tsx eval

**What happened:** Running `npx tsx -e "import { parseGitLog } from './src/ingestion/git/log.js'"` threw `Cannot find module './src/ingestion/git/log.js'`.

**Why:** `tsx -e` evaluates in a virtual `[eval]` context, not from the project root, so relative paths don't resolve.

**Fix:** Used absolute paths in the test script, or wrote tests to a temp `.ts` file and ran `npx tsx /tmp/test.ts`.

**Lesson:** For ad-hoc testing with `tsx`, write to a temp file with absolute imports rather than fighting eval-mode module resolution.

### Issue 4: `\x1e` record separator leaking into commit messages

**What happened:** Every commit message ended with a stray `\x1e` character. For example: `"added test placeholders\u001e"` instead of `"added test placeholders"`.

**Root cause:** The format string is `%H\x1f%an\x1f%aI\x1f%s\x1e` — there's no newline between `%s` (message) and `\x1e` (record separator). Git outputs them on the same line: `sha\x1fauthor\x1fdate\x1fmessage\x1e`. When we split on `\x1f`, the last element becomes `"message\x1e"`, not `"message"`. The separator that's supposed to mark the end of the header is getting concatenated onto the message field.

**Fix:** Strip the record separator from the message after parsing:
```typescript
message: message.replace(RECORD_SEP, ""),
```

**Why it wasn't caught earlier:** The test output looked correct at a glance — the `\x1e` is a non-printable character that doesn't show up in normal terminal output. It was only visible when inspecting the JSON serialization of the result. This is the kind of bug that silently corrupts data and only surfaces when the `why` command displays garbled commit messages.

**Lesson:** When using control characters as delimiters, always verify the **parsed field values** in isolation (e.g., via JSON serialization or hex dump), not just the overall structure. Non-printable characters in output are invisible in normal terminal rendering.

---

## Verification

Ran `parseGitLog()` against this repo's own git history. Results:

- **7 commits** parsed (matches `git log --all --oneline`)
- **34 total file touches** across all commits
- **5,778 total additions**
- All SHAs, authors, dates, and messages match the real git history
- File change counts (additions/deletions) are accurate per commit

Example output:
```
SHA: b81a4fed
Author: Onyeka Amechi
Date: 2026-09-09T12:48:03+01:00
Message: added test placeholders
Files changed: 3
  test/fixtures/sample-repo/README.md (+7, -0)
  test/integration/.placeholder.md (+1, -0)
  test/unit/.placeholder.md (+1, -0)
```

---

## What Remains (Day 2 scope)

All Day 2 tasks are complete. Next up is Day 3: AST parsing + code graph construction.

| Task | File | Status |
|------|------|--------|
| Parse git log | `src/ingestion/git/log.ts` | ✅ Done |
| Parse git blame | `src/ingestion/git/blame.ts` | ✅ Done |
| Persist commits to SQLite | `src/store/repository.ts` | ✅ Done |
| Update schema (unique index) | `src/store/schema.ts` | ✅ Done |

---

## Blame.ts — Implementation Notes

### What Was Done

Implemented `src/ingestion/git/blame.ts` — the second piece of Day 2's git ingestion pipeline. The function `parseGitBlame(repoRoot, filePath)` shells out to `git blame --porcelain` and returns a `BlameLine[]` mapping each line number to the commit that introduced it.

### Key Design Decision: Parse `<final-line>` from the porcelain header

Git blame's porcelain output does **not** emit one header per printed line. It emits full metadata (author, committer, summary, etc.) only when the commit changes from the previous line. Continuation lines skip straight to the tab-prefixed content:

```
b2c910a... 45 46           ← header with final-line 46
author Jane Doe             ← full metadata (commit changed)
...
\tconst timeout = 3000;    ← content line
b2c910a... 47 47           ← header with final-line 47 (same commit, no metadata)
\tconst maxRetries = 3;    ← content line
```

This means a manual running counter (counting non-metadata, non-header lines) is **fragile** — the shape of each record varies. The `<final-line>` number in the header is always authoritative, so we parse it directly.

### `execFileSync` instead of `execSync`

Used `execFileSync("git", ["blame", "--porcelain", filePath], ...)` instead of `execSync` with a template string. The reason: `filePath` is a variable that could contain spaces or special characters. Passing it as an argv element sidesteps shell quoting entirely.

`log.ts` used `execSync` because its format string is a constant we control, so shell interpolation was low-risk. `blame.ts` takes user-derived file paths, so the safer approach is warranted. (Follow-up: convert `log.ts` to `execFileSync` for consistency.)

### Verification

| Test | Result |
|------|--------|
| `src/store/db.ts` (149 lines) | 149 lines attributed, all from `192550a4` |
| `test/unit/db.test.ts` (116 lines) | 116 lines attributed, all from `f57ecd19` |
| `src/cli/index.ts` (20 lines) | 20 lines attributed, all from `cf68f01b` |
| Nonexistent file | Returns `[]` (error caught gracefully) |
| First/last line numbers | Line 1 and line N match actual file bounds |

All line counts match `wc -l` output. Line numbers are correct (1-indexed, matching the file's actual line numbers).

---

## Schema + Repository.ts — Implementation Notes

### Schema v2

Added `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_path ON files(path)` right after the `files` table definition. Bumped `SCHEMA_VERSION` from `"1"` to `"2"`. This is what makes `insertFile`'s `ON CONFLICT` dedup work — without a unique constraint, `INSERT OR IGNORE` has nothing to conflict against and silently creates duplicate rows.

The one existing test that hardcoded `expect(row.value).toBe("1")` was updated to `"2"`.

### repository.ts

Implemented all four insert functions:

| Function | Strategy | Notes |
|----------|----------|-------|
| `insertFile` | `INSERT ... ON CONFLICT(path) DO UPDATE SET path = excluded.path RETURNING id` | Atomic dedup — same path always returns same ID. The `DO UPDATE SET path = excluded.path` is a no-op (sets a column to its own value) purely to make `RETURNING id` fire on conflict too. |
| `insertCommit` | `INSERT OR IGNORE` | `sha` is already PK from schema v1, so no schema change needed. Ignores duplicate SHAs silently. |
| `insertSymbol` | `INSERT ... RETURNING id` | Day 3 scope (AST parsing), implemented now for interface consistency. |
| `insertEdge` | `INSERT ...` | Day 3 scope, implemented now for consistency. |

### Verification

Ran a manual end-to-end test against this repo:

```
insertFile dedup:        PASS ✓ (same path → same ID)
insertFile different:    PASS ✓ (different paths → different IDs)
insertCommit dedup:      PASS ✓ (same SHA → 1 row)
Real commits inserted:   7 commits → 8 rows (7 + 1 from earlier test) PASS ✓
Real files inserted:     34 unique → 36 rows (34 + 2 from earlier test) PASS ✓
Idempotent re-insert:    36 → 36 rows, no duplicates PASS ✓
```

### Gotcha: blame and uncommitted changes

While testing, discovered that `git blame` attributes uncommitted working-tree changes to SHA `00000000`. This showed up when testing `schema.ts` — the edits we'd just made (unique index + version bump) weren't committed yet, so 3 lines appeared as `00000000` in the blame output. Updated the blame test to filter these out by checking `!r.commitSha.startsWith("00000000")`.

---

## Day 3 — AST Parsing + Code Graph

### What Was Done

Implemented `src/graph/parser.ts` and `src/graph/build-graph.ts` — the code graph layer that extracts file-level structure (imports/exports) and stores it as module symbols + import edges in SQLite.

### Design: Module Symbols

The `edges` table only supports `from_symbol_id → to_symbol_id` — no file-to-file edge type. Solution: every file gets an implicit **"module" symbol** (kind: `"module"`, spanning the full file). Import edges connect module symbols.

```
insertFile("src/store/db.ts")       → file row
insertSymbol(fileId, "src/store/db.ts", "module", 1, 150)  → module symbol
insertEdge(dbModuleId, schemaModuleId, "imports")           → the actual edge
```

No schema change needed. Day 4's function/class symbols will sit inside the same file's module symbol, using the same edges table.

### parser.ts — What It Does

Uses `ts-morph` to parse each source file and extract:
- **Symbols:** top-level functions, classes, named exports (with line ranges)
- **Imports:** only relative paths (`./foo`, `../bar`) — external packages excluded

Verified against 10 real source files:
- All relative imports captured correctly (7/7 cross-checks passed)
- External packages (`better-sqlite3`, `commander`, `ts-morph`, etc.) correctly excluded
- Line ranges match actual source positions
- Files with no declarations (e.g., `index.ts`) correctly return 0 symbols

### build-graph.ts — What It Does

Two-pass approach:
1. **First pass:** insert all files + module symbols (need the IDs for edge creation)
2. **Second pass:** resolve each relative import to an actual file path, insert import edge

Import resolution handles TypeScript's common patterns:
- `.js` → `.ts` (TypeScript source uses .js extensions)
- Bare path → `index.ts` (folder imports)
- `.jsx` → `.tsx`

7/7 resolution tests passed against this repo's actual imports.

### Gotcha: blame tests and uncommitted changes

The blame test that checks "single-commit files" kept failing because it used `schema.ts` — which we'd modified but not committed. Git blame attributes uncommitted changes to SHA `00000000`, which broke the "all lines from 1 commit" assertion. Fixed by switching to `db.ts` (created in one commit, never modified). Lesson: **test files that won't change under you** — pick stable, committed files for assertions about specific commit counts.

### Gotcha: better-sqlite3 + ts-morph native addon conflict in vitest

**The problem:** `build-graph.ts` imports both `ts-morph` (via `parser.ts`) and `better-sqlite3` (via `repository.ts`). Both are native C++ addons that register cleanup hooks with the Node.js environment. When vitest tears down its worker process, the `Statement::~Statement()` destructor tries to call `RemoveEnvironmentCleanupHook`, but the environment is already gone. This crashes the worker before test results can be reported.

**What works:** Every other test file (db, log, blame, repository, parser) runs fine in vitest — they each import only ONE native addon. The crash only happens when BOTH are loaded in the same worker.

**The fix for tests:** `build-graph.test.ts` uses hand-built `ParsedFile[]` fixtures instead of running the real parser. Since `build-graph.ts` only imports `ParsedFile` as a **type** (`import type { ParsedFile }`), TypeScript strips it at compile time — ts-morph never loads at runtime. This completely sidesteps the native addon conflict while still testing all of buildGraph's actual logic (file insertion, module symbols, import resolution, edge creation, re-run dedup).

**Vitest config:** `vitest.config.ts` uses `pool: "forks"` (separate processes, not threads) to avoid the thread-level cleanup race for other native addon combinations.

---

## Day 4 — Symbol-level call resolution

### What we built

Extended the graph from file-level structure (Day 3) to symbol-level call relationships:

**parser.ts changes:**
- `ParsedSymbol` gains `calls: string[]` — simple function-call names extracted from each symbol's body via `collectCalls()`
- New `NamedImport` interface tracks which named identifiers come from which import specifier
- `ParsedFile` gains `namedImports: NamedImport[]` — used for call resolution, separate from `imports[]` which drives file-level import edges
- Only captures simple identifier calls (`foo()`), not method calls (`obj.method()`) or property-access callees
- Type-only imports excluded from `namedImports` (they don't exist at runtime)

**build-graph.ts changes:**
- Pass 1 now inserts real symbols (functions, classes, exports) alongside the module placeholder
- Pass 2 builds an import-name-to-file resolution map from `namedImports`
- Pass 3 inserts both `imports` edges (module→module) and `calls` edges (symbol→symbol)
- Call resolution order: local declaration → imported name → unresolved (skip)
- Ambiguous imports (same name from multiple files) are skipped, not guessed

**Test coverage:**
- `parser.test.ts`: 13 tests (was 7) — named imports, type-only exclusion, call collection, method-call exclusion
- `build-graph.test.ts`: 10 tests (was 5) — symbol persistence, local calls, imported calls, external package skip, ambiguous name skip
- **50/50 total tests pass**

### Verified against real repo

9 files parsed → 32 symbols → 6 import edges → 13 call edges. All cross-file relationships correct:
- `buildGraph` → `insertFile`, `insertSymbol`, `insertEdge`, `resolveImport` (cross-file imports)
- `openDatabase` → `getStoredSchemaVersion`, `setStoredSchemaVersion` (local calls)
- `checkSchemaVersion` → `getStoredSchemaVersion` (local call)

### Deliberate scope cuts

Method calls (`foo.bar()`), calls through destructuring, and re-exports are skipped. These need type-checker-backed resolution to do correctly — guessing would produce a graph that's confidently wrong rather than honestly incomplete. Consistent with v1 tradeoffs: %s-only commit messages, relative-import-only resolution, full re-index on every init.

### `collectCalls` caveat

`collectCalls` uses `forEachDescendant` which traverses the entire subtree. For a function declaration node, this includes the function's own name node as a potential call target. In practice this hasn't caused false positives (function names aren't CallExpressions), but it means the traversal is broader than strictly necessary. If false positives ever appear, tightening to only traverse the function body block would be the fix.

---

## Day 5 — `why` command

### What we built

Implemented the first user-facing command: `prism why <file:line>` and `prism why --function <name>`.

**query.ts** — Two query functions:
- `queryHistoryForLocation(db, filePath, line)` — finds commit_files rows where the line falls within the committed range, joins to commits for metadata, returns most-recent-first
- `queryHistoryForFunction(db, functionName)` — resolves the symbol to its file + line range (skipping module symbols), then queries commit_files for that range. Handles the "two-step" lookup: name → symbol → file → commits

**template.ts** — Template-based summary builder:
- `buildTemplateSummary(history, target)` — human-readable text output with commit dates, SHAs, authors, and first-line messages. Shows up to 10 commits, truncation notice for more. Tags with `confidence: documented` when history exists
- `buildTemplateSummaryJson(history, target)` — structured object for `--json` mode
- Empty history returns a clear "no history found" message instead of fabricating

**why.ts** — CLI wiring:
- Parses `file:line` format via regex, validates before querying
- `--function <name>` routes to `queryHistoryForFunction`
- `--json` flag switches to JSON output
- Fails clearly when `.prism/graph.db` doesn't exist (suggests `prism init`)

**Test coverage:**
- `query.test.ts`: 9 tests (boundary lines, exact matches, empty results, metadata, function lookup, module symbol skip)
- `template.test.ts`: 7 tests (formatting, truncation, empty history, JSON output, multi-line messages)
- **66/66 total tests pass**

### Design decisions

- **Query overlap logic:** `start_line <= target AND (end_line >= target OR end_line IS NULL)` — handles both bounded ranges and NULL end_lines (which git blame produces for partial files)
- **Function lookup is a two-step join:** name → symbols table → file_id + line range → commit_files. This means `prism why --function openDatabase` works even though the user doesn't know which file it's in
- **Module symbols excluded from function lookup:** `WHERE kind != 'module'` prevents `prism why --function src/a.ts` from matching the entire-file module symbol
- **Template summary truncates at 10 commits:** Prevents overwhelming output on heavily-modified code. The "and N more commits" notice preserves the full count
- **Confidence tag is "documented" or "none":** No "inferred" tag for v1 since we don't have AI summarization yet. The tag becomes meaningful in Phase 3

---

## Day 6 — `impact` command

### What we built

Implemented the second graph-traversal command: `prism impact <symbol>`.

**query.ts additions:**
- `resolveSymbol(db, target)` — resolves `symbol` or `file:symbol` format. Returns `ResolvedSymbol | null`. Ambiguous names (multiple matches without file prefix) return null
- `listSymbolsByName(db, name)` — returns all non-module matches for ambiguity reporting
- `queryDependents(db, symbolId, maxDepth?)` — BFS traversal of reverse `calls` edges. Uses a queue, de-duplicates visited nodes, returns `Dependent[]` sorted by depth then file then symbol

**impact.ts CLI:**
- Parses `<symbol>` argument, resolves via `resolveSymbol`, queries `queryDependents`
- Default: terminal tree grouped by file, indented by depth
- `--json`: flat list with `{ target, dependents }` structure
- Ambiguity: lists all matching symbols with file paths and exits
- Not found: clear error message

**Test coverage:**
- `query.test.ts`: 12 new tests (resolveSymbol unique/ambiguous/file:name/module skip, listSymbolsByName, queryDependents direct/transitive/empty/maxDepth/cycle handling)
- **78/78 total tests pass**

### Design decisions

- **Only `calls` edges for impact traversal, not `imports`:** Import edges connect module symbols (entire files). Following them would flood output with "every file imports every file it uses" — not useful for "what breaks if I change this function?" The `calls` edge graph is the meaningful dependency structure
- **BFS, not DFS:** BFS naturally discovers dependents level by level, giving accurate depth numbers. DFS would require post-processing to compute depths correctly
- **Cycle handling via visited set:** Once a symbol is visited, it's never re-queued. This prevents infinite loops and gives correct (shortest-path) depths
- **`file:symbol` disambiguation uses `lastIndexOf(":")`:** Handles paths like `src/commands/init.ts:registerInitCommand` where the file path itself contains no colons but the separator does
- **Max depth parameter:** `queryDependents` accepts an optional `maxDepth` for future use (e.g., `--depth 2` flag). Not exposed in CLI yet — v1 defaults to unlimited

---

## Day 7 — GitHub API integration

### What we built

Integrated GitHub PR/issue data into the `why` command output.

**tokens.ts** — Token storage:
- `getGitHubToken()` checks (1) `PRISM_GITHUB_TOKEN` env var, (2) `~/.config/prism/token` file
- `setGitHubToken()` writes to `~/.config/prism/token` with mode 0o600
- Simple file-based storage for v1. OS keychain is a post-v1 enhancement

**pr-issue-link.ts** — GitHub API integration:
- `linkCommitsToPrsAndIssues(client, commitShas)` — batch fetches PR associations for commits via `listPullRequestsAssociatedWithCommit`. Rate-limit aware (stops at <10 remaining). Capped at 200 commits max
- `fetchPrDetails(client, prNumbers)` — fetches PR title+body for specific PR numbers
- Owner/repo resolved from env vars (`PRISM_GITHUB_OWNER`, `PRISM_GITHUB_REPO`) or git remote URL
- PR body truncated to 500 chars for storage

**repository.ts** — new `insertPrIssueLink()` function (INSERT OR IGNORE)

**query.ts** — History queries now include PR/issue data:
- `HistoryEntry` gains `prNumbers: number[]` and `prTitles: string[]`
- `enrichWithPrData()` helper batch-queries `pr_issue_links` table and merges into results
- Both `queryHistoryForLocation` and `queryHistoryForFunction` use enrichment

**template.ts** — PR info in output:
- Shows `PR #42: Title` below each commit when available
- Falls back to `PR #99` when title is missing

**Test coverage:**
- `template.test.ts`: 2 new tests (PR number+title display, PR without title)
- **80/80 total tests pass**

### Design decisions

- **Env vars override file storage:** `PRISM_GITHUB_TOKEN` takes precedence over `~/.config/prism/token`. This supports both CI (env vars) and local dev (config file)
- **Rate limit safety:** Stops PR lookups when remaining API calls < 10, returning partial results. No data loss — incomplete enrichment is better than a crash
- **200 commit cap:** Prevents rate-limit exhaustion on large histories. The most recent 200 commits are typically the most relevant
- **PR body truncation at 500 chars:** Avoids storing huge PR descriptions that would bloat the database. The title is usually sufficient for context
- **No re-fetching in `why`:** PR data is fetched once during `init` and stored in `pr_issue_links`. The `why` command reads from the database, not the API. This keeps `why` fast and offline-capable

---

## Key Takeaways for Future Work

1. **Always test against a real repo with real history.** The 1MB default `maxBuffer` bug would have been invisible on the scaffold project but fatal on any production codebase.

2. **Read the raw output of shell commands before writing parsers.** The block-splitting bug came from assuming `\x1e` would cleanly delimit self-contained blocks. A 30-second look at the raw output would have shown the actual structure.

3. **Control-character separators are the right choice** — they eliminate collision risk entirely. But they require understanding the exact output format of the command, not just the semantics of the separator.

4. **Stateful line-by-line parsing is more robust than split-then-process** for structured output that doesn't have clean record boundaries.

5. **`%s` only captures the subject line, not the full commit body.** If `why` output feels thin for commits with detailed messages, switch to `%B` (full body). But `%B` contains literal newlines, so the parsing strategy would need to change — the body would span multiple lines between the header and the next numstat block, and would need a different termination signal (e.g., detect the next header line). Not needed for v1, but worth knowing where to look.

6. **`insertFile` dedupes but `insertSymbol`/`insertEdge` don't.** Day 2 added a unique index on `files.path` so `INSERT OR IGNORE` handles re-runs. But `symbols` and `edges` have no unique index — plain INSERT duplicates them on every re-run. The fix for v1: wipe `symbols` and `edges` at the start of `buildGraph` (full re-index model). If incremental indexing is ever needed, unique indexes on `(file_id, name, kind)` and `(from_symbol_id, to_symbol_id, edge_type)` would be the path.

7. **tsx scripts that import ts-morph + better-sqlite3 hang if db opens before project.** The `openDatabase()` call acquires a SQLite lock. If `createProject()` (which loads the full TypeScript compiler via ts-morph) runs afterward, the combination can stall. Always parse files first, then open db for writing. This ordering matters for tsx verification scripts but doesn't affect production code where the pipeline is sequential.
