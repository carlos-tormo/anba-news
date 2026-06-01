import {
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  Partials
} from "discord.js";
import { handleCommand, registerCommands } from "./commands.js";
import { assertRequiredEnv, env } from "./config.js";
import { handleDmAnswer } from "./journalist.js";
import { startScheduler } from "./scheduler.js";
import { JsonStore } from "./store.js";

assertRequiredEnv();

const store = new JsonStore(env.dataFile);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, async (readyClient) => {
  await registerCommands(readyClient, env.discordGuildId);
  startScheduler(readyClient, store);
  console.log(`Logged in as ${readyClient.user.tag}. Commands registered.`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    await handleCommand(interaction, client, store);
  } catch (error) {
    console.error("[interaction] command failed", error);
    const content = error instanceof Error ? error.message : "Command failed.";

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content).catch(() => undefined);
    } else {
      await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleDmAnswer(message, store);
  } catch (error) {
    console.error("[dm] answer handling failed", error);
  }
});

await client.login(env.discordToken);
