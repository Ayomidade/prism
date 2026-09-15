import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
