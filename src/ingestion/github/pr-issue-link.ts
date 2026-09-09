import type { Octokit } from "@octokit/rest";

// Links commit SHAs to their associated PRs/issues via the GitHub API.
// Only called during `init` when a token is configured. Rate-limit aware,
// caps lookups to avoid rate-limit issues on very large histories.
// See docs/prism-v1-build-spec.md Section 7, step 7.

export interface PrIssueLink {
  commitSha: string;
  prNumber?: number;
  issueNumber?: number;
  title?: string;
  body?: string;
}

export async function linkCommitsToPrsAndIssues(
  _client: Octokit,
  _commitShas: string[]
): Promise<PrIssueLink[]> {
  // TODO: implement per docs/prism-v1-build-spec.md Section 7, step 7
  throw new Error("linkCommitsToPrsAndIssues: not implemented yet");
}
