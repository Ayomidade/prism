# Build Plan
## PRISM — Codebase Intelligence Tool

This is a real portfolio project, not a hackathon, so the plan is scoped as **three phases** rather than three days. Each phase is broken into small daily tasks so progress stays trackable even working solo alongside other commitments.

---

## Phase 1 — Foundation (Days 1-3)

```
Day 1
├── Project setup
│   ├── Init TypeScript + Node CLI project (commander/yargs for CLI parsing)
│   ├── Set up repo, linting, basic test runner
│   └── Define SQLite schema (commits, files, symbols, edges, PR/issue cache)
│
Day 2
├── Git ingestion
│   ├── Shell-out wrapper for git log/blame/diff
│   ├── Parse raw git output into structured commit objects
│   └── Store commit history in SQLite
│
Day 3
├── Code graph (part 1)
│   ├── AST parser setup (ts-morph or typescript-estree)
│   ├── Extract imports/exports per file
│   └── Store file-level nodes/edges in SQLite
```

---

## Phase 2 — Core Functionality (Days 4-7)

```
Day 4
├── Code graph (part 2)
│   ├── Resolve function/symbol-level call relationships
│   └── Build full dependency graph (not just file-level)
│
Day 5
├── `why` command
│   ├── Query commit history for a given file/line/function
│   ├── Template-based summary (no-AI fallback)
│   └── Confidence tagging (documented vs inferred)
│
Day 6
├── `impact` command
│   ├── Query graph for direct + transitive dependents of a symbol
│   ├── Terminal tree output
│   └── `--json` output mode
│
Day 7
├── GitHub API integration
│   ├── Token config (local storage, read-only scope)
│   ├── Fetch linked PRs/issues for commits
│   └── Merge into `why` output
```

---

## Phase 3 — AI, Polish, Ship (Days 8-12)

```
Day 8
├── Optional AI summarization
│   ├── Pluggable summarizer interface
│   ├── Anthropic API integration (opt-in, user's own key)
│   └── Confidence tag: "AI-inferred"
│
Day 9
├── HTML export
│   ├── Static responsive HTML report generator for `impact`
│   ├── Sanitize all injected content (commit msgs, paths, PR titles)
│   └── Test across screen sizes
│
Day 10
├── Error handling & edge cases
│   ├── No git history / shallow clone handling
│   ├── Renamed/moved file tracing
│   ├── Large repo performance pass (caching, incremental re-index)
│   └── Missing token / missing AI key graceful fallbacks
│
Day 11
├── Testing
│   ├── Unit tests for parsers and query engine
│   ├── Integration test against a real sample repo
│   └── Manual test on 2-3 real open-source repos
│
Day 12
├── Deployment & demo
│   ├── Publish to npm (`npx prism`)
│   ├── Write README with install + usage examples
│   ├── Record a short demo (terminal + HTML report)
│   └── Portfolio write-up: problem → research → build → outcome
```

---

## Notes

- Phase boundaries are flexible — if AI summarization or HTML export take longer than expected, they can slip a day without blocking the rest, since both are "should have" not "must have" per the PRD.
- Testing on real repos (Day 11) matters more than synthetic tests here, since the whole value proposition is "does this work on a messy, real, 5-year-old codebase."
- The demo (Day 12) is what actually gets shown in a portfolio or interview, so it's worth treating as a deliverable in its own right, not an afterthought.
