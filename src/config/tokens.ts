// Local storage for the optional GitHub token (and, post-v1, an AI API key).
// Prefer the OS keychain where available, falling back to a local config
// file excluded from git via .gitignore. Never log or embed a raw token in
// any output (including the HTML export, once that's built).
// See docs/technical-architecture.md Section 5 (Authentication) and
// Section 10 (Security Considerations).

export function getGitHubToken(): string | undefined {
  // TODO: read from OS keychain or local config file
  return process.env.PRISM_GITHUB_TOKEN;
}

export function setGitHubToken(_token: string): void {
  // TODO: write to OS keychain or local config file
  throw new Error("setGitHubToken: not implemented yet");
}
