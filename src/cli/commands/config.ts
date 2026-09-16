import type { Command } from "commander";
import { select, input } from "@inquirer/prompts";
import { setProviderKey, setGitHubToken, setModel, listConfig, getProviderKey } from "../../config/tokens.js";
import { fetchModelsForProvider } from "../../summarize/providers.js";
import type { ProviderId } from "../../summarize/providers.js";

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
    .description("Set the AI model for a provider — interactive if provider/model omitted")
    .argument("[provider]", "Provider name (anthropic, openai, gemini, groq, custom)")
    .argument("[model]", "Model name — if omitted, pick interactively from live available models")
    .action(async (provider: string | undefined, model: string | undefined) => {
      if (provider && !VALID_PROVIDERS.includes(provider)) {
        console.error(
          `Error: Unknown provider "${provider}". Expected one of: ${VALID_PROVIDERS.join(", ")}`
        );
        process.exit(1);
      }

      // Direct, non-interactive path — unchanged existing behavior.
      if (provider && model) {
        setModel(provider, model);
        console.log(`${provider} model set to ${model}.`);
        return;
      }

      // Interactive path.
      const chosenProvider: string =
        provider ??
        (await select({
          message: "Which provider?",
          choices: VALID_PROVIDERS.map((id) => ({ name: id, value: id })),
        }));

      const apiKey = getProviderKey(chosenProvider);
      if (!apiKey) {
        console.error(
          `No key configured for "${chosenProvider}". Run: prism config set-key ${chosenProvider} <key>`
        );
        process.exit(1);
      }

      const baseUrl = process.env.PRISM_AI_BASE_URL;
      let chosenModel: string;

      try {
        console.log(`Fetching available models for ${chosenProvider}...`);
        const models = await fetchModelsForProvider(
          chosenProvider as ProviderId,
          apiKey,
          baseUrl
        );

        if (models.length === 0) throw new Error("No models returned");

        chosenModel = await select({
          message: "Which model?",
          choices: models.map((m) => ({ name: m, value: m })),
        });
      } catch (err: any) {
        // Graceful degradation — never dead-end the command over a failed
        // discovery call (network issue, provider doesn't support listing,
        // custom provider with no PRISM_AI_BASE_URL set, etc.)
        console.log(`Could not fetch model list (${err.message}). Enter one manually.`);
        chosenModel = await input({ message: "Model name:" });
      }

      setModel(chosenProvider, chosenModel);
      console.log(`${chosenProvider} model set to ${chosenModel}.`);
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
