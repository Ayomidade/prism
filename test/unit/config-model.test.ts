import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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

describe("prism config set-model", () => {
  let fakeHome: string;

  afterEach(() => {
    if (fakeHome && existsSync(fakeHome)) {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("stores a model for a provider", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "prism-test-home-"));
    const configDir = join(fakeHome, ".config", "prism");

    const { stdout, exitCode } = run(fakeHome, "config", "set-model", "openai", "gpt-4o");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("openai model set to gpt-4o");
    expect(readFileSync(join(configDir, "openai-model"), "utf-8").trim()).toBe("gpt-4o");
  });

  it("rejects invalid provider", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "prism-test-home-"));
    const { exitCode } = run(fakeHome, "config", "set-model", "invalid", "model");
    expect(exitCode).toBe(1);
  });

  it("errors when no key is configured for the provider", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "prism-test-home-"));
    const { exitCode } = run(fakeHome, "config", "set-model", "openai");
    expect(exitCode).toBe(1);
  });
});

describe("prism config show", () => {
  let fakeHome: string;

  afterEach(() => {
    if (fakeHome && existsSync(fakeHome)) {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("shows 'not set' when nothing is configured", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "prism-test-home-"));
    const { stdout, exitCode } = run(fakeHome, "config", "show");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("GitHub token:  not set");
    expect(stdout).toContain("Anthropic key: not set");
    expect(stdout).toContain("Openai key: not set");
  });

  it("shows keys and models when configured", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "prism-test-home-"));
    const configDir = join(fakeHome, ".config", "prism");

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "openai-key"), "sk-test\n", { mode: 0o600 });
    writeFileSync(join(configDir, "openai-model"), "gpt-4o\n", { mode: 0o600 });

    const { stdout, exitCode } = run(fakeHome, "config", "show");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Openai key: set");
    expect(stdout).toContain("Model:       gpt-4o (custom)");
  });
});
