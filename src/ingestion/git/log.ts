import { execSync } from "node:child_process";

// Parses `git log --all --numstat --format=...` into structured commit data.
// See docs/prism-v1-build-spec.md Section 7, step 2.

// Control characters as separators — cannot appear in normal commit text,
// so there is zero collision risk with commit messages.
const RECORD_SEP = "\x1e"; // separates commits
const UNIT_SEP = "\x1f"; // separates fields within a commit header

export interface ParsedCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
  filesChanged: Array<{ path: string; additions: number; deletions: number }>;
}

/**
 * Runs `git log` against the given repo root and parses the output into
 * structured commit objects.
 *
 * Uses `--numstat` for per-file addition/deletion counts.
 * Uses control-character separators (\x1e, \x1f) to avoid collision with
 * arbitrary commit message text.
 *
 * Edge cases handled:
 *   - Merge commits (2+ parents): git produces no numstat by default,
 *     so filesChanged is an empty array.
 *   - Root commits (0 parents): git diffs against an empty tree normally,
 *     these produce numstat like any other commit.
 *   - Binary files: numstat shows "-" for additions/deletions, mapped to 0.
 *   - Empty repos: git log returns empty output, returns [].
 *
 * @param repoRoot - Absolute path to the git repository root
 * @returns Array of parsed commits, ordered newest-first (git log default)
 */
export async function parseGitLog(repoRoot: string): Promise<ParsedCommit[]> {
  // The format string builds a record per commit:
  //   <sha>\x1f<author>\x1f<date>\x1f<message>\x1e
  //
  // --numstat appends per-file stats after each commit's header block.
  // --all includes all branches/tags (not just HEAD).
  //
  // maxBuffer: 100MB. The default 1MB is far too small for any repo with
  // meaningful history — git log output grows linearly with commit count
  // and file churn. Without this, execSync throws ENOBUFS on real repos.
  const format = `%H${UNIT_SEP}%an${UNIT_SEP}%aI${UNIT_SEP}%s${RECORD_SEP}`;

  let raw: string;
  try {
    raw = execSync(
      `git log --all --numstat --format="${format}"`,
      {
        cwd: repoRoot,
        encoding: "utf-8",
        maxBuffer: 100 * 1024 * 1024, // 100MB
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch {
    // git log fails if not inside a repo, or if the repo has zero commits.
    // Both are valid "nothing to index" states.
    return [];
  }

  if (!raw || raw.trim().length === 0) {
    return [];
  }

  // Parse lines sequentially. Git's --format + --numstat output looks like:
  //
  //   <sha>\x1f<author>\x1f<date>\x1f<message>\x1e\n
  //   \n
  //   <additions>\t<deletions>\t<path>\n
  //   <additions>\t<deletions>\t<path>\n
  //   <sha>\x1f<author>\x1f<date>\x1f<message>\x1e\n
  //   ...
  //
  // The \x1e appears right after the header, BEFORE the numstat lines.
  // We cannot split on \x1e and treat each block as self-contained — the
  // numstat for commit N lives in the same block as the header for commit N+1.
  //
  // Instead, we detect header lines (they contain \x1f) and accumulate numstat
  // lines until the next header or end of input.

  const lines = raw.split("\n");
  const commits: ParsedCommit[] = [];
  let current: ParsedCommit | null = null;

  for (const line of lines) {
    if (line.includes(UNIT_SEP)) {
      // This is a header line — finalize the previous commit if any
      if (current) {
        commits.push(current);
      }

      const parts = line.split(UNIT_SEP);
      if (parts.length < 4) continue; // malformed, skip

      const [sha, author, date, message] = parts;
      current = {
        sha,
        author,
        date,
        // The \x1e record separator sits on the same line as %s in git's
        // output (no newline between %s and \x1e in the format string).
        // Strip it so it doesn't leak into the message field.
        message: message.replace(RECORD_SEP, ""),
        filesChanged: [],
      };
    } else if (current) {
      // This is a numstat line (or blank line between header and numstat).
      // Format: "<additions>\t<deletions>\t<path>"
      // Merge commits have no numstat — they produce blank lines only,
      // which we skip here, leaving filesChanged as an empty array.
      if (line.trim().length === 0) continue;

      const tabParts = line.split("\t");
      if (tabParts.length < 3) continue; // malformed numstat line

      const [addStr, delStr, filePath] = tabParts;

      // Binary files show "-" for both additions and deletions
      const additions = addStr === "-" ? 0 : parseInt(addStr, 10);
      const deletions = delStr === "-" ? 0 : parseInt(delStr, 10);

      current.filesChanged.push({ path: filePath, additions, deletions });
    }
  }

  // Don't forget the last commit
  if (current) {
    commits.push(current);
  }

  return commits;
}
