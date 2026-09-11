// Follows a file's history through renames/moves via `git log --follow`,
// so blame/history lookups stay accurate across a rename.
// See docs/prd.md Section 10 (Edge Cases — renamed/moved files).

import { execFileSync } from "node:child_process";

export interface RenameEvent {
  oldPath: string;
  newPath: string;
  commitSha: string;
}

/**
 * Traces a file's rename history using `git log --follow --name-status`.
 *
 * Returns an array of rename events from oldest to newest. Each event
 * represents a rename/move of the file at a specific commit.
 *
 * @param repoRoot - Absolute path to the git repository root
 * @param filePath - Current file path relative to repo root
 * @returns Array of rename events, oldest first. Empty if no renames found.
 */
export async function traceRenames(
  repoRoot: string,
  filePath: string,
): Promise<RenameEvent[]> {
  let raw: string;
  try {
    // --follow: trace file across renames
    // --name-status: output status letter (R100, R050, etc.) + paths
    // --diff-filter=R: only show rename commits
    // %H: full commit SHA
    raw = execFileSync(
      "git",
      [
        "log",
        "--follow",
        "--name-status",
        "--diff-filter=R",
        "--format=%H",
        "--no-renames", // don't use default rename detection, we want explicit --follow
        filePath,
      ],
      {
        cwd: repoRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB — file rename history is much smaller than full log
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch {
    // File not found, no history, or git error — no renames to report
    return [];
  }

  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const lines = raw.split("\n");
  const events: RenameEvent[] = [];
  let currentSha: string | null = null;

  for (const line of lines) {
    if (line.length === 0) continue;

    // Commit SHA line (40 hex chars, alone on the line)
    if (/^[0-9a-f]{40}$/.test(line)) {
      currentSha = line;
      continue;
    }

    // Rename line: "R100\told_path\tnew_path"
    if (line.startsWith("R") && currentSha) {
      const tabParts = line.split("\t");
      if (tabParts.length >= 3) {
        const oldPath = tabParts[1];
        const newPath = tabParts[2];
        events.push({ oldPath, newPath, commitSha: currentSha });
      }
    }
  }

  // Return oldest-first (git log outputs newest-first)
  return events.reverse();
}
