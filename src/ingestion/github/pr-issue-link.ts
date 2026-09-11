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

/** Maximum number of commits to look up PR/issue data for. */
const MAX_COMMIT_LOOKUPS = 200;

/**
 * Fetches PR/issue links for a batch of commit SHAs.
 *
 * Uses the GitHub API to find pull requests associated with each commit,
 * then fetches PR title and body for context. Rate-limit aware — stops
 * if remaining API calls drop below a safe threshold.
 *
 * @param client     - Authenticated Octokit client
 * @param commitShas - Commit SHAs to look up
 * @returns Array of PR/issue links (only commits with associated PRs are included)
 */
export async function linkCommitsToPrsAndIssues(
  client: Octokit,
  commitShas: string[]
): Promise<PrIssueLink[]> {
  const results: PrIssueLink[] = [];
  const shas = commitShas.slice(0, MAX_COMMIT_LOOKUPS);

  // Resolve owner/repo once, not per-commit
  let owner: string;
  let repo: string;
  try {
    owner = await getOwner(client);
    repo = await getRepo();
  } catch {
    return results; // Can't determine repo — return empty
  }

  for (const sha of shas) {
    // Check rate limit before each batch
    const rateLimit = await client.rateLimit.get();
    if (rateLimit.data.resources.core.remaining < 10) {
      // Near rate limit — stop gracefully, return what we have
      break;
    }

    try {
      const { data: prs } = await client.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: sha,
      });

      // The endpoint returns PR objects directly
      for (const pr of prs) {
        results.push({
          commitSha: sha,
          prNumber: pr.number,
          title: pr.title ?? undefined,
          body: truncateBody(pr.body),
        });
      }
    } catch {
      // Commit not found, no PRs, or API error — skip silently
    }
  }

  return results;
}

/**
 * Fetches PR details (title + body) for specific PR numbers.
 * Used by `why` to enrich output with PR context.
 */
export async function fetchPrDetails(
  client: Octokit,
  prNumbers: number[]
): Promise<Map<number, { title: string; body: string }>> {
  const details = new Map<number, { title: string; body: string }>();

  let owner: string;
  let repo: string;
  try {
    owner = await getOwner(client);
    repo = await getRepo();
  } catch {
    return details;
  }

  for (const prNumber of prNumbers) {
    try {
      const { data: pr } = await client.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      details.set(prNumber, {
        title: pr.title,
        body: truncateBody(pr.body) ?? "",
      });
    } catch {
      // PR not found or API error — skip silently
    }
  }

  return details;
}

/** Extracts owner from the authenticated user's repos, or uses env. */
async function getOwner(client: Octokit): Promise<string> {
  const envOwner = process.env.PRISM_GITHUB_OWNER;
  if (envOwner) return envOwner;

  const { data } = await client.users.getAuthenticated();
  return data.login;
}

/** Extracts repo name from the current git remote. */
async function getRepo(): Promise<string> {
  const envRepo = process.env.PRISM_GITHUB_REPO;
  if (envRepo) return envRepo;

  // Try to read from git remote
  const { execSync } = await import("node:child_process");
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    // Parse owner/repo from URL: https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const match = remote.match(/[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) return match[2];
  } catch {
    // Not in a git repo or no remote — fallback
  }

  throw new Error(
    "Cannot determine repository. Set PRISM_GITHUB_REPO env var or run from a git repo with a remote."
  );
}

/** Truncates PR body to a reasonable length for storage. */
function truncateBody(body: string | null | undefined): string | undefined {
  if (!body) return undefined;
  const trimmed = body.trim();
  if (trimmed.length === 0) return undefined;
  // Cap at 500 chars to avoid storing huge PR descriptions
  return trimmed.length > 500 ? trimmed.slice(0, 500) + "..." : trimmed;
}
