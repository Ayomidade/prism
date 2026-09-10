import { execFileSync } from "node:child_process";

// Parses `git blame --porcelain <file>` to map each line in the file back
// to the commit that introduced it. See docs/prism-v1-build-spec.md Section 7, step 3.

export interface BlameLine {
  line: number;
  commitSha: string;
}

// Matches a porcelain header line: "<40-hex-sha> <orig-line> <final-line> [<group-size>]"
const HEADER_RE = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/;

/**
 * Runs `git blame --porcelain` against a single file and returns a
 * line-number -> commit-sha mapping.
 *
 * Uses the final-line number embedded in each porcelain header rather than
 * a manual running counter — porcelain output doesn't emit one header per
 * "line printed", it emits full metadata only when the commit changes from
 * the previous line, so counting non-metadata lines yourself is fragile.
 *
 * Edge cases handled:
 *   - Empty file: git produces no output, returns [].
 *   - Binary / untracked / nonexistent file: git exits non-zero, caught
 *     and returns [] rather than throwing.
 *
 * @param repoRoot - Absolute path to the git repository root
 * @param filePath - Path to the file, relative to repoRoot
 */
export async function parseGitBlame(
  repoRoot: string,
  filePath: string
): Promise<BlameLine[]> {
  let raw: string;
  try {
    // execFileSync (not execSync) — passes filePath as an argv element,
    // not interpolated into a shell string, so no quoting/escaping needed
    // even if the path contains spaces or special characters.
    raw = execFileSync("git", ["blame", "--porcelain", filePath], {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB — single-file output, smaller than full log
      stdio: ["pipe", "pipe", "pipe"], // suppress git's stderr from leaking to the console
    });
  } catch {
    // Binary file, untracked file, or file doesn't exist — all "nothing to blame" states.
    return [];
  }

  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const lines = raw.split("\n");
  const result: BlameLine[] = [];

  let pendingSha: string | null = null;
  let pendingLine: number | null = null;

  for (const line of lines) {
    if (line.startsWith("\t")) {
      // Content line — finalize whatever header we're currently attributing to
      if (pendingSha !== null && pendingLine !== null) {
        result.push({ line: pendingLine, commitSha: pendingSha });
      }
      pendingSha = null;
      pendingLine = null;
      continue;
    }

    const match = line.match(HEADER_RE);
    if (match) {
      const [, sha, , finalLine] = match;
      pendingSha = sha;
      pendingLine = parseInt(finalLine, 10);
      continue;
    }

    // Otherwise: a metadata line (author, committer, summary, etc.) — skip it.
    // These only appear between a header and its content line, so no
    // pending state needs to change here.
  }

  return result;
}
