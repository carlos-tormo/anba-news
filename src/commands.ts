import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { askRandomGms, askSpecificGm, countUnpostedAnswers, publishNews } from "./journalist.js";
import type { JsonStore } from "./store.js";

const gmCommand = new SlashCommandBuilder()
  .setName("gm")
  .setDescription("Manage NBA2K league GMs.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Register or update a GM.")
      .addUserOption((option) => option.setName("user").setDescription("Discord user.").setRequired(true))
      .addStringOption((option) => option.setName("team").setDescription("Franchise name.").setRequired(true))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Deactivate a GM.")
      .addUserOption((option) => option.setName("user").setDescription("Discord user.").setRequired(true))
  )
  .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List registered GMs."));

const journalistCommand = new SlashCommandBuilder()
  .setName("journalist")
  .setDescription("Configure and operate the league journalist.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("configure")
      .setDescription("Configure daily journalist behavior.")
      .addChannelOption((option) =>
        option
          .setName("news_channel")
          .setDescription("Channel where news will be posted.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addIntegerOption((option) =>
        option
          .setName("daily_questions")
          .setDescription("Number of random GMs to ask each day.")
          .setMinValue(1)
          .setMaxValue(30)
      )
      .addIntegerOption((option) =>
        option.setName("ask_hour").setDescription("Hour to send DMs, 0-23.").setMinValue(0).setMaxValue(23)
      )
      .addIntegerOption((option) =>
        option.setName("publish_hour").setDescription("Hour to publish news, 0-23.").setMinValue(0).setMaxValue(23)
      )
      .addStringOption((option) => option.setName("timezone").setDescription("IANA timezone, e.g. Europe/Madrid."))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("ask-now")
      .setDescription("Send journalist questions immediately.")
      .addUserOption((option) => option.setName("user").setDescription("Specific GM to ask."))
      .addIntegerOption((option) =>
        option.setName("count").setDescription("Random GM count if no user is selected.").setMinValue(1).setMaxValue(30)
      )
  )
  .addSubcommand((subcommand) => subcommand.setName("publish-now").setDescription("Publish news from unposted answers."))
  .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show journalist status."));

export const commandPayloads = [gmCommand.toJSON(), journalistCommand.toJSON()];

export async function registerCommands(client: Client, guildId?: string): Promise<void> {
  if (guildId) {
    const guild = await client.guilds.fetch(guildId);
    await guild.commands.set(commandPayloads);
    return;
  }

  if (!client.application) {
    throw new Error("Discord application was not ready while registering commands.");
  }

  await client.application.commands.set(commandPayloads);
}

export async function handleCommand(interaction: ChatInputCommandInteraction, client: Client, store: JsonStore): Promise<void> {
  if (interaction.commandName === "gm") {
    await handleGmCommand(interaction, store);
    return;
  }

  if (interaction.commandName === "journalist") {
    await handleJournalistCommand(interaction, client, store);
  }
}

async function handleGmCommand(interaction: ChatInputCommandInteraction, store: JsonStore): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "set") {
    const user = interaction.options.getUser("user", true);
    const team = interaction.options.getString("team", true).trim();
    const member = await interaction.guild?.members.fetch(user.id).catch(() => undefined);
    const displayName = member?.displayName ?? user.username;

    await store.mutate((data) => {
      data.gms[user.id] = {
        userId: user.id,
        team,
        displayName,
        active: true,
        addedAt: data.gms[user.id]?.addedAt ?? new Date().toISOString()
      };
    });

    await interaction.reply({ content: `Registered ${displayName} as GM of ${team}.`, ephemeral: true });
    return;
  }

  if (subcommand === "remove") {
    const user = interaction.options.getUser("user", true);
    await store.mutate((data) => {
      if (data.gms[user.id]) {
        data.gms[user.id].active = false;
      }
    });
    await interaction.reply({ content: `Removed ${user.username} from the active GM pool.`, ephemeral: true });
    return;
  }

  if (subcommand === "list") {
    const data = await store.read();
    const gms = Object.values(data.gms).filter((gm) => gm.active);
    const content = gms.length
      ? gms.map((gm) => `- ${gm.displayName}: ${gm.team}`).join("\n")
      : "No active GMs registered.";
    await interaction.reply({ content, ephemeral: true });
  }
}

async function handleJournalistCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
  store: JsonStore
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "configure") {
    const newsChannel = interaction.options.getChannel("news_channel");
    const dailyQuestions = interaction.options.getInteger("daily_questions");
    const askHour = interaction.options.getInteger("ask_hour");
    const publishHour = interaction.options.getInteger("publish_hour");
    const timezone = interaction.options.getString("timezone");

    const settings = await store.mutate((data) => {
      if (newsChannel) {
        data.settings.newsChannelId = newsChannel.id;
      }
      if (dailyQuestions !== null) {
        data.settings.dailyQuestionCount = dailyQuestions;
      }
      if (askHour !== null) {
        data.settings.askHour = askHour;
      }
      if (publishHour !== null) {
        data.settings.publishHour = publishHour;
      }
      if (timezone) {
        data.settings.timezone = timezone.trim();
      }
      return data.settings;
    });

    await interaction.reply({
      content: [
        "Journalist configuration updated.",
        `News channel: ${settings.newsChannelId ? `<#${settings.newsChannelId}>` : "not set"}`,
        `Daily questions: ${settings.dailyQuestionCount}`,
        `Ask hour: ${settings.askHour}:00`,
        `Publish hour: ${settings.publishHour}:00`,
        `Timezone: ${settings.timezone}`
      ].join("\n"),
      ephemeral: true
    });
    return;
  }

  if (subcommand === "ask-now") {
    await interaction.deferReply({ ephemeral: true });
    const user = interaction.options.getUser("user");
    const count = interaction.options.getInteger("count");
    const result = user
      ? await askSpecificGm(client, store, user.id)
      : await askRandomGms(client, store, count ?? (await store.read()).settings.dailyQuestionCount);

    await interaction.editReply(
      `Attempted ${result.attempted} DM question(s). Sent ${result.sent}. Failed ${result.failed}.`
    );
    return;
  }

  if (subcommand === "publish-now") {
    await interaction.deferReply({ ephemeral: true });
    const result = await publishNews(client, store);
    if (!result.posted) {
      await interaction.editReply(`No article posted: ${result.reason}`);
      return;
    }

    await interaction.editReply(`Published "${result.title}" using ${result.answersUsed} answer(s).`);
    return;
  }

  if (subcommand === "status") {
    const data = await store.read();
    const activeGms = Object.values(data.gms).filter((gm) => gm.active).length;
    const pendingPrompts = data.prompts.filter((prompt) => prompt.status === "sent").length;
    await interaction.reply({
      content: [
        `Active GMs: ${activeGms}`,
        `Pending DM answers: ${pendingPrompts}`,
        `Unposted answers: ${countUnpostedAnswers(data)}`,
        `News channel: ${data.settings.newsChannelId ? `<#${data.settings.newsChannelId}>` : "not set"}`,
        `Schedule: asks at ${data.settings.askHour}:00, publishes at ${data.settings.publishHour}:00 (${data.settings.timezone})`
      ].join("\n"),
      ephemeral: true
    });
  }
}
