import type { Command } from "commander";
import { select, input, confirm } from "@inquirer/prompts";
import { setProviderKey, setGitHubToken, setModel, listConfig, getProviderKey, removeProviderKey, removeGitHubToken } from "../../config/tokens.js";
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
      try {
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
      } catch (err: any) {
        if (err?.name === "ExitPromptError") {
          console.log("\nCancelled.");
          process.exit(0);
        }
        throw err;
      }
    });

  config
    .command("remove-key")
    .description("Remove a stored API key or token")
    .action(async () => {
      try {
        const cfg = listConfig();

        const choices = [
          ...cfg.providers.map((p) => ({
            name: p.keySet ? `${p.id} (configured)` : p.id,
            value: p.id,
            disabled: !p.keySet ? "not configured" : false,
          })),
          {
            name: cfg.githubToken ? "github (configured)" : "github",
            value: "github",
            disabled: !cfg.githubToken ? "not configured" : false,
          },
        ];

        const hasAny = cfg.providers.some((p) => p.keySet) || cfg.githubToken;
        if (!hasAny) {
          console.error("No keys configured. Nothing to remove.");
          process.exit(1);
        }

        const target = await select({
          message: "Which key to remove?",
          choices,
        });

        const confirmed = await confirm({
          message: `Remove ${target} key?`,
          default: true,
        });

        if (!confirmed) {
          console.log("Cancelled.");
          return;
        }

        if (target === "github") {
          removeGitHubToken();
        } else {
          removeProviderKey(target);
        }

        console.log(`Removed ${target} key.`);
      } catch (err: any) {
        if (err?.name === "ExitPromptError") {
          console.log("\nCancelled.");
          process.exit(0);
        }
        throw err;
      }
    });

  config
    .command("switch-provider")
    .description("Switch AI provider — shows only providers with saved keys")
    .action(async () => {
      try {
        const cfg = listConfig();
        const providersWithKeys = cfg.providers.filter((p) => p.keySet);

        if (providersWithKeys.length === 0) {
          console.error("No providers configured. Run: prism config set-key <provider> <key>");
          process.exit(1);
        }

        let chosenProvider: string;

        if (providersWithKeys.length === 1) {
          chosenProvider = providersWithKeys[0].id;
          console.log(`Only one provider configured: ${chosenProvider}`);
        } else {
          chosenProvider = await select({
            message: "Which provider? (API key required)",
            choices: providersWithKeys.map((p) => ({
              name: `${p.id} (model: ${p.model ?? "default"})`,
              value: p.id,
            })),
          });
        }

        const apiKey = getProviderKey(chosenProvider)!;
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
          console.log(`Could not fetch model list (${err.message}). Enter one manually.`);
          chosenModel = await input({ message: "Model name:" });
        }

        setModel(chosenProvider, chosenModel);
        console.log(`\nSwitched to ${chosenProvider} (${chosenModel}).`);
      } catch (err: any) {
        if (err?.name === "ExitPromptError") {
          console.log("\nCancelled.");
          process.exit(0);
        }
        throw err;
      }
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
