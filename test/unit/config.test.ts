import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = "src/cli/index.ts";

function run(homeDir: string, ...args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", CLI, ...args], {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, HOME: homeDir },
    });
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

describe("prism config set-key", () => {
  let fakeHome: string;

  afterEach(() => {
    if (fakeHome && existsSync(fakeHome)) {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("stores an anthropic key", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "prism-test-home-"));
    const configDir = join(fakeHome, ".config", "prism");

    const { stdout, exitCode } = run(fakeHome, "config", "set-key", "anthropic", "sk-ant-test123");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("anthropic key stored");
    expect(readFileSync(join(configDir, "anthropic-key"), "utf-8").trim()).toBe("sk-ant-test123");
  });

  it("stores a github token", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "prism-test-home-"));
    const configDir = join(fakeHome, ".config", "prism");

    const { stdout, exitCode } = run(fakeHome, "config", "set-key", "github", "ghp_testtoken");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("GitHub token stored");
    expect(readFileSync(join(configDir, "token"), "utf-8").trim()).toBe("ghp_testtoken");
  });

  it("rejects invalid target", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "prism-test-home-"));
    const { exitCode } = run(fakeHome, "config", "set-key", "invalid", "key");
    expect(exitCode).toBe(1);
  });

  it("rejects missing arguments", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "prism-test-home-"));
    const { exitCode } = run(fakeHome, "config", "set-key");
    expect(exitCode).toBe(1);
  });
});
