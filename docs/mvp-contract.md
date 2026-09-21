# TRACECODE — MVP Contract (v1 Frozen Scope)

**Category:** Code Intelligence / Developer Tool
**Interface:** Local-first CLI
**Primary users:** JS/TS developers
**Core promise:** Understand your codebase before you change it.
**Tagline:** TBD

---

## What v1 must do — no more, no less

```
tracecode init
    ↓
Index repository (git history + code structure)
    ↓
Build code + git graph (stored locally in SQLite)

tracecode why <file>:<line>
    ↓
Look up commit/PR/issue history for that location
    ↓
Explain why the code exists (confidence-tagged)

tracecode impact <symbol>
    ↓
Trace dependency graph for that symbol
    ↓
Show what could break (direct + transitive dependents)
```

Three commands. That's it. If a feature doesn't serve one of these three flows, it does not belong in v1.

---

## In scope for v1

- `tracecode init` — local git ingestion + AST-based code graph, stored in SQLite
- `tracecode why` — commit history + optional GitHub PR/issue context, confidence-tagged
- `tracecode why` — multi-provider AI summarization (Anthropic, OpenAI, Gemini, Groq, custom endpoint) with template fallback when no key configured
- `tracecode impact` — dependency graph traversal, terminal tree output
- `tracecode impact --html` — standalone responsive HTML report export
- `--json` output mode on both `why` and `impact`
- Graceful handling of: no git history, shallow clones, missing GitHub token, missing AI key
- npm package, installable/runnable via `npx tracecode`

## Explicitly out of scope for v1

- VS Code extension
- Runtime error tracing
- Environment/setup diagnostics ("why doesn't this run")
- Any hosted/SaaS component, any user accounts, any server

---

## Definition of done for v1

- Running `tracecode init` on a real, existing JS/TS repo completes without crashing and produces a usable local graph
- Running `tracecode why <file>:<line>` on that repo returns a correct, sourced explanation (not a hallucination) for at least a handful of real functions
- Running `tracecode impact <symbol>` on that repo returns a correct, complete list of direct dependents (verified manually against the actual codebase)
- Both commands work with zero tokens/keys configured
- Package installs and runs via `npx tracecode` from a clean environment
