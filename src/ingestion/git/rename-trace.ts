// Follows a file's history through renames/moves via `git log --follow`,
// so blame/history lookups stay accurate across a rename.
// See docs/prd.md Section 10 (Edge Cases — renamed/moved files).

export interface RenameEvent {
  oldPath: string;
  newPath: string;
  commitSha: string;
}

export async function traceRenames(_repoRoot: string, _filePath: string): Promise<RenameEvent[]> {
  // TODO: shell out to `git log --follow --name-status`, parse rename entries
  throw new Error("traceRenames: not implemented yet");
}
