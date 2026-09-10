# Day 2 — Build Log (linking.md)

## What Was Done

Completed all of Phase 1, Day 2 per `docs/build-plan.md`: git ingestion and SQLite persistence.

| Module | File | What it does |
|--------|------|-------------|
| Git log parser | `src/ingestion/git/log.ts` | `parseGitLog()` — shells out to `git log`, returns structured `ParsedCommit[]` |
| Git blame parser | `src/ingestion/git/blame.ts` | `parseGitBlame()` — shells out to `git blame --porcelain`, returns line→SHA mapping |
| Schema v2 | `src/store/schema.ts` | Added unique index on `files.path`, bumped version to `"2"` |
| Repository | `src/store/repository.ts` | `insertFile`, `insertCommit`, `insertSymbol`, `insertEdge` — all working with dedup |
| Tests | `test/unit/blame.test.ts`, `test/unit/repository.test.ts` | 15 new tests across both files |

**Test suite: 27/27 passing, typecheck clean.**

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

## Key Takeaways for Future Work

1. **Always test against a real repo with real history.** The 1MB default `maxBuffer` bug would have been invisible on the scaffold project but fatal on any production codebase.

2. **Read the raw output of shell commands before writing parsers.** The block-splitting bug came from assuming `\x1e` would cleanly delimit self-contained blocks. A 30-second look at the raw output would have shown the actual structure.

3. **Control-character separators are the right choice** — they eliminate collision risk entirely. But they require understanding the exact output format of the command, not just the semantics of the separator.

4. **Stateful line-by-line parsing is more robust than split-then-process** for structured output that doesn't have clean record boundaries.

5. **`%s` only captures the subject line, not the full commit body.** If `why` output feels thin for commits with detailed messages, switch to `%B` (full body). But `%B` contains literal newlines, so the parsing strategy would need to change — the body would span multiple lines between the header and the next numstat block, and would need a different termination signal (e.g., detect the next header line). Not needed for v1, but worth knowing where to look.
