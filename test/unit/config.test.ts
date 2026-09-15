import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CLI = "src/cli/index.ts";
const CONFIG_DIR = join(homedir(), ".config", "prism");

function run(...args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", CLI, ...args], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

describe("prism config set-key", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    // Clean up any test keys we created
    for (const target of ["anthropic", "openai", "gemini", "groq", "custom"]) {
      const f = join(CONFIG_DIR, `${target}-key`);
      if (existsSync(f)) rmSync(f);
    }
  });

  it("stores an anthropic key", () => {
    const { stdout, exitCode } = run("config", "set-key", "anthropic", "sk-ant-test123");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("anthropic key stored");
    expect(readFileSync(join(CONFIG_DIR, "anthropic-key"), "utf-8").trim()).toBe("sk-ant-test123");
  });

  it("stores a github token", () => {
    const { stdout, exitCode } = run("config", "set-key", "github", "ghp_testtoken");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("GitHub token stored");
    expect(readFileSync(join(CONFIG_DIR, "token"), "utf-8").trim()).toBe("ghp_testtoken");
  });

  it("rejects invalid target", () => {
    const { exitCode } = run("config", "set-key", "invalid", "key");
    expect(exitCode).toBe(1);
  });

  it("rejects missing arguments", () => {
    const { exitCode } = run("config", "set-key");
    expect(exitCode).toBe(1);
  });
});
