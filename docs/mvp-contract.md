# PRISM — MVP Contract (v1 Frozen Scope)

**Category:** Code Intelligence / Developer Tool
**Interface:** Local-first CLI
**Primary users:** JS/TS developers
**Core promise:** Understand your codebase before you change it.
**Tagline:** TBD

---

## What v1 must do — no more, no less

```
prism init
    ↓
Index repository (git history + code structure)
    ↓
Build code + git graph (stored locally in SQLite)

prism why <file>:<line>
    ↓
Look up commit/PR/issue history for that location
    ↓
Explain why the code exists (confidence-tagged)

prism impact <symbol>
    ↓
Trace dependency graph for that symbol
    ↓
Show what could break (direct + transitive dependents)
```

Three commands. That's it. If a feature doesn't serve one of these three flows, it does not belong in v1.

---

## In scope for v1

- `prism init` — local git ingestion + AST-based code graph, stored in SQLite
- `prism why` — commit history + optional GitHub PR/issue context, template-based summary by default, confidence-tagged
- `prism impact` — dependency graph traversal, terminal tree output
- `--json` output mode on both `why` and `impact`
- Graceful handling of: no git history, missing GitHub token, missing AI key
- npm package, installable/runnable via `npx prism`

## Explicitly out of scope for v1

- VS Code extension
- AI-assisted summarization (optional stretch, not required for v1 to ship — template-based fallback is the real v1 default)
- HTML report export (moved to a fast-follow, not required for the MVP contract to be satisfied)
- Runtime error tracing
- Environment/setup diagnostics ("why doesn't this run")
- Any hosted/SaaS component, any user accounts, any server

**Note:** this tightens the PRD's "should have" list. AI summarization and the HTML export were "should have" in the PRD, but for the frozen v1 contract they're reclassified as fast-follow, not required to ship. The three commands above, with template-based `why` and terminal-only `impact`, are what "v1 done" means. Everything else ships after v1 is real and working on a real repo.

---

## Definition of done for v1

- Running `prism init` on a real, existing JS/TS repo completes without crashing and produces a usable local graph
- Running `prism why <file>:<line>` on that repo returns a correct, sourced explanation (not a hallucination) for at least a handful of real functions
- Running `prism impact <symbol>` on that repo returns a correct, complete list of direct dependents (verified manually against the actual codebase)
- Both commands work with zero tokens/keys configured
- Package installs and runs via `npx prism` from a clean environment
