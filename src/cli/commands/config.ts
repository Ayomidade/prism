import type { Command } from "commander";
import { setProviderKey, setGitHubToken, setModel, listConfig } from "../../config/tokens.js";

const VALID_PROVIDERS = ["anthropic", "openai", "gemini", "groq", "custom"];
const VALID_TARGETS = [...VALID_PROVIDERS, "github"];

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Manage PRISM configuration (API keys, tokens, models)");

  config
    .command("set-key")
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

  config
    .command("set-model")
    .description("Set the AI model for a provider (written to ~/.config/prism/)")
    .argument("<provider>", "Provider name (anthropic, openai, gemini, groq, custom)")
    .argument("<model>", "Model name (e.g. gpt-4o, claude-sonnet-4-20250514)")
    .action((provider: string, model: string) => {
      if (!VALID_PROVIDERS.includes(provider)) {
        console.error(
          `Error: Unknown provider "${provider}". Expected one of: ${VALID_PROVIDERS.join(", ")}`
        );
        process.exit(1);
      }

      setModel(provider, model);
      console.log(`${provider} model set to ${model}.`);
    });

  config
    .command("show")
    .description("Display all configured keys, tokens, and models")
    .action(() => {
      const cfg = listConfig();

      console.log("GitHub token:  " + (cfg.githubToken ? "set" : "not set"));
      console.log("");

      for (const p of cfg.providers) {
        const keyStatus = p.keySet ? "set" : "not set";
        console.log(`${capitalize(p.id)} key: ${keyStatus}`);
        if (p.keySet) {
          const modelDisplay = p.model ? `${p.model} (custom)` : `${p.id === "custom" ? "(not set)" : "(default)"}`;
          console.log(`  Model:       ${modelDisplay}`);
        }
      }
    });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
