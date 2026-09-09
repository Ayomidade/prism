// Runs `git blame` per tracked file to map current lines back to the
// commit that introduced them. See docs/prism-v1-build-spec.md Section 7, step 3.

export interface BlameLine {
  line: number;
  commitSha: string;
}

export async function parseGitBlame(_repoRoot: string, _filePath: string): Promise<BlameLine[]> {
  // TODO: shell out to `git blame --line-porcelain`, parse output
  throw new Error("parseGitBlame: not implemented yet");
}
