import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Local storage for the optional GitHub token (and, post-v1, an AI API key).
// Falls back to a local config file in ~/.config/prism/. Never logs or embeds
// a raw token in any output.
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
  // Env var takes precedence
  const envToken = process.env.PRISM_GITHUB_TOKEN;
  if (envToken) return envToken;

  // Fall back to config file
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
