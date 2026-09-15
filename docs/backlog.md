# PRISM — Backlog

Tracked follow-ups from ongoing review. Not scheduled to specific days — pull from here as capacity allows.

---

## Verification gaps

Claimed as working, but not yet verified end-to-end the way `impact`'s bug fix was.

- **GitHub PR/issue enrichment (`github-fetch.ts`)** — built and unit-tested in isolation, but not yet verified end-to-end against a real token and a real repo with linked PRs/issues. Code path: token set → `github.ts` fetches PRs → `github-fetch.ts` queries them → `pr_issue_links` table populated → `why` output includes PR numbers/titles. Needs a real `PRISM_GITHUB_TOKEN` + a repo where commits have linked PRs.

---

## Process

- **Return to atomic, single-purpose commits.** `temp` (an actual commit message) and a single commit bundling 15 unrelated bug fixes plus a new feature plus tests both broke the discipline established in Days 1–3. Not fixable retroactively without rewriting shared history — just worth deliberately returning to going forward.

---

## Completed

- ~~Module-symbol display in `impact` output~~ — fixed: `formatTree` shows `(top-level code)` for module-kind dependents, HTML renderer uses per-kind icons.
- ~~`imports` edges never queried~~ — fixed: `queryDependents` now follows both `calls` and `imports` edges.
- ~~`log.test.ts` / `blame.test.ts` coupled to live git history~~ — fixed: both use an isolated fixture repo created in a temp directory during `beforeAll`.
- ~~`npx prism` from a clean install~~ — fixed: `package.json` bin/main/types paths corrected to match tsup output (`dist/index.js`). Verified via `npm link`.
- ~~`mvp-contract.md` stale~~ — updated: AI summarization and HTML export marked as in scope.
- ~~`build-plan.md` historical~~ — marked as historical, points to `linking.md` for the actual build log.
- ~~`build-graph.ts` dead code~~ — deleted.
- ~~`rename-trace.ts` unused~~ — deleted.
- ~~Top-level call blind spot~~ — fixed via `moduleCalls`, verified end-to-end, regression test added.
- ~~Import ambiguity dedup bug~~ — fixed (was marking same-name-same-target imports as ambiguous incorrectly).
