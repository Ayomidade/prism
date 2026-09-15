# PRISM — Backlog

Tracked follow-ups from ongoing review. Not scheduled to specific days — pull from here as capacity allows.

---

## Cosmetic

- **Module-symbol display in `impact` output** — a module-level dependent currently prints its file path twice (`src/ingestion/db-write.ts` / `src/ingestion/db-write.ts`), since a module symbol's `name` is its own file path. Compare to a real function dependent, which reads sensibly (`src/cli/commands/why.ts` / `registerWhyCommand`). Fix: in the terminal formatter, when `symbol.kind === 'module'`, print something like `(top-level code)` instead of repeating the path. Not urgent — data is correct, just confusing to read.

---

## Correctness / design gaps

- **`imports` edges are never queried.** Day 3 built the full file-level import graph (module-to-module `imports` edges), but nothing in `query.ts` or the CLI ever reads `edge_type = 'imports'` — `impact` only follows `calls` edges. Needs a decision: fold `imports` into `impact` too (broader but noisier results), or formally document them as reserved/unused for now rather than leaving the gap implicit.

- **`log.test.ts` / `blame.test.ts` are coupled to this project's own live git history** — exact commit counts, exact line numbers, exact "this file has one commit" assumptions. This is the same fragility class that caused the Day 3 `schema.ts` incident (a test broke the moment the file's real commit count changed). A dedicated fixture repo already exists, unused, at `test/fixtures/sample-repo/`. Flagged twice now; worth migrating these tests off live project history and onto that fixture instead.

---

## Verification gaps

Claimed as working, but not yet verified end-to-end the way `impact`'s bug fix was.

- **`npx prism` from a real clean install.** The MVP contract's own definition of done includes "package installs and runs via `npx prism` from a clean environment." Everything tested so far has run via `tsx` in dev mode — never verified as an actual packaged/published artifact.
- **GitHub PR/issue enrichment (`github-fetch.ts`)** — built and unit-tested in isolation, but not yet verified end-to-end against a real token and a real repo with linked PRs/issues.

---

## Documentation drift

- **`mvp-contract.md` is stale.** It explicitly scoped AI summarization and HTML export as fast-follow, not v1. Both have since shipped. The "frozen v1" contract no longer describes what's actually built. Not that the extra scope was wrong — just that an unmaintained contract stops being a useful reference. Needs a reconciliation pass.
- **`build-plan.md`'s Day 4–7 breakdown no longer matches reality.** Call resolution, `why`, `impact`, GitHub integration, AI summarization, HTML export, and error handling all landed in a different order and grouping than originally planned (several bundled into large "Phase 2.5" / "Day 8" / "Day 10" commits). Worth either updating the plan to reflect what happened, or explicitly marking it historical/superseded so it doesn't mislead anyone reading it later.

---

## Process

- **Return to atomic, single-purpose commits.** `temp` (an actual commit message) and a single commit bundling 15 unrelated bug fixes plus a new feature plus tests both broke the discipline established in Days 1–3. Not fixable retroactively without rewriting shared history — just worth deliberately returning to going forward.

---

## Dead / unresolved from earlier reviews (already closed, listed for record)

- ~~`build-graph.ts` dead code~~ — deleted.
- ~~`rename-trace.ts` unused~~ — deleted.
- ~~Top-level call blind spot (`impact` couldn't see calls made in top-level script code)~~ — fixed via `moduleCalls`, verified end-to-end, regression test added.
- ~~Import ambiguity dedup bug~~ — fixed (was marking same-name-same-target imports as ambiguous incorrectly).