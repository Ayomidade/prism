import type { Command } from "commander";
import { setProviderKey, setGitHubToken } from "../../config/tokens.js";

const VALID_PROVIDERS = ["anthropic", "openai", "gemini", "groq", "custom"];
const VALID_TARGETS = [...VALID_PROVIDERS, "github"];

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Manage PRISM configuration (API keys, tokens)");

  config
    .command("set-key")
    .option("-h, --help", "Show help for the set-key command")
    .description("Store an API key or token locally (written to ~/.config/prism/)")
    .argument("<target>", "Provider name (anthropic, openai, gemini, groq, custom) or 'github'")
    .argument("<key>", "API key or token value")
    .action((target: string, key: string) => {
      if (!VALID_TARGETS.includes(target)) {
        console.error(
          `Error: Unknown target "${target}". Expected one of: ${VALID_TARGETS.join(", ")}`
        );
        process.exit(1);
      }

      if (target === "github") {
        setGitHubToken(key);
        console.log("GitHub token stored.");
      } else {
        setProviderKey(target, key);
        console.log(`${target} key stored.`);
      }
    });
}
