import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Local storage for optional tokens: GitHub API token + per-AI-provider
// keys. Falls back to a local config file in ~/.config/prism/. Never logs
// or embeds a raw token in any output.
// See docs/technical-architecture.md Section 5 (Authentication) and
// Section 10 (Security Considerations).

const CONFIG_DIR = join(homedir(), ".config", "prism");
const TOKEN_FILE = join(CONFIG_DIR, "token");

/**
 * Reads the GitHub token. Checks (in order):
 *   1. PRISM_GITHUB_TOKEN env var
 *   2. ~/.config/prism/token file
 *
 * @returns The token string, or undefined if not configured
 */
export function getGitHubToken(): string | undefined {
  const envToken = process.env.PRISM_GITHUB_TOKEN;
  if (envToken) return envToken;

  if (existsSync(TOKEN_FILE)) {
    try {
      return readFileSync(TOKEN_FILE, "utf-8").trim();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Stores the GitHub token to ~/.config/prism/token.
 * Creates the config directory if it doesn't exist.
 */
export function setGitHubToken(token: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, token + "\n", { mode: 0o600 });
}

/**
 * Reads an AI provider's key. Checks (in order):
 *   1. PRISM_<PROVIDER>_KEY env var (e.g. PRISM_OPENAI_KEY, PRISM_GEMINI_KEY)
 *   2. ~/.config/prism/<provider>-key file
 *
 * Generalizes what was previously a single hardcoded getAnthropicKey() —
 * same lookup pattern, parametrized by provider id.
 */
export function getProviderKey(providerId: string): string | undefined {
  const envVar = `PRISM_${providerId.toUpperCase()}_KEY`;
  const envKey = process.env[envVar];
  if (envKey) return envKey;

  const keyFile = join(CONFIG_DIR, `${providerId}-key`);
  if (existsSync(keyFile)) {
    try {
      return readFileSync(keyFile, "utf-8").trim();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Stores an AI provider's key to ~/.config/prism/<provider>-key.
 * Creates the config directory if it doesn't exist.
 */
export function setProviderKey(providerId: string, key: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, `${providerId}-key`), key + "\n", { mode: 0o600 });
}

/**
 * Reads the model override for an AI provider. Checks (in order):
 *   1. PRISM_AI_MODEL env var (global override, backwards-compatible)
 *   2. ~/.config/prism/<provider>-model file
 *
 * @returns The model string, or undefined if not configured (caller should use default)
 */
export function getModel(providerId: string): string | undefined {
  const envModel = process.env.PRISM_AI_MODEL;
  if (envModel) return envModel;

  const modelFile = join(CONFIG_DIR, `${providerId}-model`);
  if (existsSync(modelFile)) {
    try {
      return readFileSync(modelFile, "utf-8").trim();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Stores a model override for an AI provider to ~/.config/prism/<provider>-model.
 * Creates the config directory if it doesn't exist.
 */
export function setModel(providerId: string, model: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, `${providerId}-model`), model + "\n", { mode: 0o600 });
}

/**
 * Returns the full configuration state for display in `prism config show`.
 * Does NOT return sensitive values (keys/tokens) — only whether they exist.
 */
export function listConfig(): {
  githubToken: boolean;
  providers: { id: string; keySet: boolean; model: string | undefined }[];
} {
  return {
    githubToken: !!getGitHubToken(),
    providers: ["anthropic", "openai", "gemini", "groq", "custom"].map((id) => ({
      id,
      keySet: !!getProviderKey(id),
      model: getModel(id),
    })),
  };
}

/**
 * Removes an AI provider's key file from ~/.config/prism/.
 * Returns true if a file was deleted, false if no file existed.
 */
export function removeProviderKey(providerId: string): boolean {
  const keyFile = join(CONFIG_DIR, `${providerId}-key`);
  if (existsSync(keyFile)) {
    rmSync(keyFile);
    return true;
  }
  return false;
}

/**
 * Removes the GitHub token file from ~/.config/prism/.
 * Returns true if a file was deleted, false if no file existed.
 */
export function removeGitHubToken(): boolean {
  if (existsSync(TOKEN_FILE)) {
    rmSync(TOKEN_FILE);
    return true;
  }
  return false;
}

const ACTIVE_PROVIDER_FILE = join(CONFIG_DIR, "active-provider");

/**
 * Reads the stored active provider preference.
 * Returns undefined if no preference has been set (falls through to auto-detect).
 */
export function getActiveProvider(): string | undefined {
  if (existsSync(ACTIVE_PROVIDER_FILE)) {
    try {
      return readFileSync(ACTIVE_PROVIDER_FILE, "utf-8").trim();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Persists the active provider preference to ~/.config/prism/active-provider.
 * Creates the config directory if it doesn't exist.
 */
export function setActiveProvider(providerId: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(ACTIVE_PROVIDER_FILE, providerId + "\n", { mode: 0o600 });
}

/**
 * Removes the active provider preference, resetting to auto-detect.
 * Returns true if a file was deleted, false if no file existed.
 */
export function removeActiveProvider(): boolean {
  if (existsSync(ACTIVE_PROVIDER_FILE)) {
    rmSync(ACTIVE_PROVIDER_FILE);
    return true;
  }
  return false;
}
