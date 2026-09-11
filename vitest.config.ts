import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use forks pool — each test file runs in its own child process.
    // Required because better-sqlite3's native C++ cleanup hooks crash
    // during vitest's thread worker teardown (RemoveEnvironmentCleanupHook
    // assertion). Forks use separate processes which handle cleanup correctly.
    pool: "forks",
  },
});
