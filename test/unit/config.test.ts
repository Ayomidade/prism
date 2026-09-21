import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdtempSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = "src/cli/index.ts";

function run(
  homeDir: string,
  ...args: string[]
): { stdout: string; exitCode: number } {
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

describe("tracecode config set-key", () => {
  let fakeHome: string;

  afterEach(() => {
    if (fakeHome && existsSync(fakeHome)) {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("stores an anthropic key", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "tracecode-test-home-"));
    const configDir = join(fakeHome, ".config", "tracecode");

    const { stdout, exitCode } = run(
      fakeHome,
      "config",
      "set-key",
      "anthropic",
      "sk-ant-test123",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("anthropic key stored");
    expect(readFileSync(join(configDir, "anthropic-key"), "utf-8").trim()).toBe(
      "sk-ant-test123",
    );
  });

  it("stores a github token", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "tracecode-test-home-"));
    const configDir = join(fakeHome, ".config", "tracecode");

    const { stdout, exitCode } = run(
      fakeHome,
      "config",
      "set-key",
      "github",
      "ghp_testtoken",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("GitHub token stored");
    expect(readFileSync(join(configDir, "token"), "utf-8").trim()).toBe(
      "ghp_testtoken",
    );
  });

  it("rejects invalid target", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "tracecode-test-home-"));
    const { exitCode } = run(fakeHome, "config", "set-key", "invalid", "key");
    expect(exitCode).toBe(1);
  });

  it("rejects missing arguments", () => {
    fakeHome = mkdtempSync(join(tmpdir(), "tracecode-test-home-"));
    const { exitCode } = run(fakeHome, "config", "set-key");
    expect(exitCode).toBe(1);
  });
});

// ── removeProviderKey (unit test) ──────────────────────────────

import {
  removeProviderKey,
  getActiveProvider,
  setActiveProvider,
  removeActiveProvider,
} from "../../src/config/tokens.js";
import { homedir } from "node:os";

describe("removeProviderKey", () => {
  const configDir = join(homedir(), ".config", "tracecode");

  it("removes an existing key file", () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "testremove-key"), "test-key\n", {
      mode: 0o600,
    });

    expect(existsSync(join(configDir, "testremove-key"))).toBe(true);
    const removed = removeProviderKey("testremove");
    expect(removed).toBe(true);
    expect(existsSync(join(configDir, "testremove-key"))).toBe(false);
  });

  it("returns false when no key file exists", () => {
    const removed = removeProviderKey("nonexistent-provider-xyz");
    expect(removed).toBe(false);
  });
});

// ── active provider (unit tests) ──────────────────────────────

describe("active provider", () => {
  const configDir = join(homedir(), ".config", "tracecode");

  it("setActiveProvider writes a file", () => {
    mkdirSync(configDir, { recursive: true });
    setActiveProvider("groq");
    expect(
      readFileSync(join(configDir, "active-provider"), "utf-8").trim(),
    ).toBe("groq");
  });

  it("getActiveProvider reads it back", () => {
    mkdirSync(configDir, { recursive: true });
    setActiveProvider("gemini");
    expect(getActiveProvider()).toBe("gemini");
  });

  it("removeActiveProvider deletes the file", () => {
    mkdirSync(configDir, { recursive: true });
    setActiveProvider("anthropic");
    expect(existsSync(join(configDir, "active-provider"))).toBe(true);
    const removed = removeActiveProvider();
    expect(removed).toBe(true);
    expect(existsSync(join(configDir, "active-provider"))).toBe(false);
  });

  it("removeActiveProvider returns false when no file exists", () => {
    const removed = removeActiveProvider();
    expect(removed).toBe(false);
  });

  it("getActiveProvider returns undefined when no file exists", () => {
    const removed = removeActiveProvider();
    expect(getActiveProvider()).toBeUndefined();
  });
});
