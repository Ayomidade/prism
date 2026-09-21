# Work Plan: Model Selection UX

**Problem:** Default AI models may not be accessible (Groq's `llama-3.3-70b-versatile` returned 404 on a real run). Users can override via `TRACECODE_AI_MODEL` env var, but there's no CLI to set/view the model, no per-provider model storage, and error messages don't name the provider or model that failed.

**Goal:** Users can set, view, and override AI models per-provider from the CLI. Error messages tell you exactly what failed.

---

## Step 1: Per-provider model storage (`tokens.ts`)

Add two functions to `src/config/tokens.ts`:

```ts
getModel(providerId: string): string | undefined
setModel(providerId: string, model: string): void
```

Storage pattern: `~/.config/tracecode/<providerId>-model` (same as `<providerId>-key` but for model name).

Lookup order for `getModel`:

1. `TRACECODE_AI_MODEL` env var (global override, backwards-compatible)
2. `~/.config/tracecode/<providerId>-model` file

Files touched: `src/config/tokens.ts`

---

## Step 2: Wire per-provider model into provider resolution (`providers.ts`)

Update `buildConfig()` in `src/summarize/providers.ts`:

Current:

```ts
const model = process.env.TRACECODE_AI_MODEL || provider.defaultModel;
```

New:

```ts
const model = getModel(id) || provider.defaultModel;
```

This makes the lookup chain: env var > per-provider file > hardcoded default.

Files touched: `src/summarize/providers.ts`

---

## Step 3: Add `config set-model` subcommand (`config.ts`)

New subcommand on the existing `config` command:

```
tracecode config set-model <provider> <model>
```

Validates provider name (anthropic, openai, gemini, groq, custom). Writes to `~/.config/tracecode/<provider>-model`.

Files touched: `src/cli/commands/config.ts`

---

## Step 4: Add `config show` subcommand (`config.ts`)

New subcommand:

```
tracecode config show
```

Displays all configured state:

- Which GitHub token is set (yes/no, not the actual value)
- For each provider: key set? model set? (show the model name if set, show "default" if not)

Output format:

```
GitHub token:  set
Anthropic key: set
  Model:       claude-sonnet-4-20250514 (default)
OpenAI key:    not set
Gemini key:    set
  Model:       gemini-2.0-flash (custom)
Groq key:      not set
Custom key:    not set
```

Files touched: `src/cli/commands/config.ts`

---

## Step 5: Improve error messages in summarizers

Both `anthropic.ts` and `openai-compatible.ts` catch errors and display them as:

```
(AI analysis unavailable: <raw error>)
```

Change to:

```
(AI analysis unavailable: <provider> (<model>) — <human-readable error>)
```

For example:

```
(AI analysis unavailable: groq (llama-3.3-70b-versatile) — model not found)
```

The provider ID and model name come from the `ResolvedProviderConfig` already passed to both summarizers.

Files touched: `src/summarize/anthropic.ts`, `src/summarize/openai-compatible.ts`

---

## Step 6: Tests

| File                              | Tests                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `test/unit/tokens.test.ts` (new)  | `getModel` reads env var, reads model file, falls back to undefined; `setModel` writes file |
| `test/unit/providers.test.ts`     | `buildConfig` uses per-provider model file, env var overrides file                          |
| `test/unit/config.test.ts`        | `set-model` stores file, `show` displays correct output, invalid provider rejected          |
| `test/unit/ai-summarizer.test.ts` | Error messages include provider name and model                                              |

---

## Step 7: Typecheck + full test suite

Run `npm run typecheck` and `npx vitest run`. Expect 147+ tests passing.

---

## Files touched (summary)

| File                                 | Change                                     |
| ------------------------------------ | ------------------------------------------ |
| `src/config/tokens.ts`               | Add `getModel()`, `setModel()`             |
| `src/summarize/providers.ts`         | Update `buildConfig()` to use `getModel()` |
| `src/cli/commands/config.ts`         | Add `set-model` and `show` subcommands     |
| `src/summarize/anthropic.ts`         | Improve error message                      |
| `src/summarize/openai-compatible.ts` | Improve error message                      |
| `test/unit/tokens.test.ts`           | New: model storage tests                   |
| `test/unit/providers.test.ts`        | Add model resolution tests                 |
| `test/unit/config.test.ts`           | Add set-model and show tests               |
