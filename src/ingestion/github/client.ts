import { Octokit } from "@octokit/rest";

// Optional, token-gated GitHub API wrapper. Must never be required for
// `init`/`why`/`impact` to work — always fail gracefully to "no PR/issue
// context available". See docs/technical-architecture.md Section 4 (APIs).

export function createGitHubClient(token: string | undefined): Octokit | null {
  if (!token) return null;
  return new Octokit({
    auth: token,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}
