// Parses `git log --all --numstat --format=...` into structured commit data.
// See docs/prism-v1-build-spec.md Section 7, step 2.

export interface ParsedCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
  filesChanged: Array<{ path: string; additions: number; deletions: number }>;
}

export async function parseGitLog(_repoRoot: string): Promise<ParsedCommit[]> {
  // TODO: shell out to `git log`, parse output
  throw new Error("parseGitLog: not implemented yet");
}
