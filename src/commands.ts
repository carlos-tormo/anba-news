import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { askRandomGms, askSpecificGm, countUnpostedAnswers, publishNews } from "./journalist.js";
import type { JsonStore } from "./store.js";

function formatChannelList(channelIds: string[]): string {
  return channelIds.length > 0 ? channelIds.map((channelId) => `<#${channelId}>`).join(", ") : "sin configurar";
}

const gmCommand = new SlashCommandBuilder()
  .setName("gm")
  .setDescription("Gestiona los GMs de la liga NBA2K.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("asignar")
      .setDescription("Registra o actualiza un GM.")
      .addUserOption((option) => option.setName("usuario").setDescription("Usuario de Discord.").setRequired(true))
      .addStringOption((option) => option.setName("equipo").setDescription("Nombre de la franquicia.").setRequired(true))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("quitar")
      .setDescription("Desactiva a un GM.")
      .addUserOption((option) => option.setName("usuario").setDescription("Usuario de Discord.").setRequired(true))
  )
  .addSubcommand((subcommand) => subcommand.setName("lista").setDescription("Muestra los GMs registrados."));

const journalistCommand = new SlashCommandBuilder()
  .setName("periodista")
  .setDescription("Configura y usa el periodista de la liga.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("configurar")
      .setDescription("Configura el comportamiento diario del periodista.")
      .addChannelOption((option) =>
        option
          .setName("canal_noticias")
          .setDescription("Canal donde se publicarán las noticias.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addChannelOption((option) =>
        option
          .setName("canal_contexto_1")
          .setDescription("Primer canal para leer contexto reciente, por ejemplo #noticias.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addChannelOption((option) =>
        option
          .setName("canal_contexto_2")
          .setDescription("Segundo canal para leer contexto reciente, por ejemplo #transacciones.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addIntegerOption((option) =>
        option
          .setName("preguntas_diarias")
          .setDescription("Número de GMs aleatorios a preguntar cada día.")
          .setMinValue(1)
          .setMaxValue(30)
      )
      .addIntegerOption((option) =>
        option.setName("hora_preguntas").setDescription("Hora para enviar DMs, 0-23.").setMinValue(0).setMaxValue(23)
      )
      .addIntegerOption((option) =>
        option.setName("hora_publicacion").setDescription("Hora para publicar noticias, 0-23.").setMinValue(0).setMaxValue(23)
      )
      .addIntegerOption((option) =>
        option
          .setName("horas_contexto")
          .setDescription("Horas hacia atrás para leer contexto reciente.")
          .setMinValue(1)
          .setMaxValue(168)
      )
      .addBooleanOption((option) =>
        option.setName("borrar_contexto").setDescription("Borra los canales de contexto configurados.")
      )
      .addStringOption((option) => option.setName("zona_horaria").setDescription("Zona horaria IANA, ej. Europe/Madrid."))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("preguntar-ahora")
      .setDescription("Envía preguntas del periodista inmediatamente.")
      .addUserOption((option) => option.setName("usuario").setDescription("GM concreto al que preguntar."))
      .addIntegerOption((option) =>
        option.setName("cantidad").setDescription("Número de GMs aleatorios si no eliges usuario.").setMinValue(1).setMaxValue(30)
      )
  )
  .addSubcommand((subcommand) => subcommand.setName("publicar-ahora").setDescription("Publica noticias con respuestas pendientes."))
  .addSubcommand((subcommand) => subcommand.setName("estado").setDescription("Muestra el estado del periodista."));

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

  if (interaction.commandName === "periodista") {
    await handleJournalistCommand(interaction, client, store);
  }
}

async function handleGmCommand(interaction: ChatInputCommandInteraction, store: JsonStore): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "asignar") {
    const user = interaction.options.getUser("usuario", true);
    const team = interaction.options.getString("equipo", true).trim();
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

    await interaction.reply({ content: `${displayName} queda registrado como GM de ${team}.`, ephemeral: true });
    return;
  }

  if (subcommand === "quitar") {
    const user = interaction.options.getUser("usuario", true);
    await store.mutate((data) => {
      if (data.gms[user.id]) {
        data.gms[user.id].active = false;
      }
    });
    await interaction.reply({ content: `${user.username} ha sido eliminado del grupo de GMs activos.`, ephemeral: true });
    return;
  }

  if (subcommand === "lista") {
    const data = await store.read();
    const gms = Object.values(data.gms).filter((gm) => gm.active);
    const content = gms.length
      ? gms.map((gm) => `- ${gm.displayName}: ${gm.team}`).join("\n")
      : "No hay GMs activos registrados.";
    await interaction.reply({ content, ephemeral: true });
  }
}

async function handleJournalistCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
  store: JsonStore
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "configurar") {
    const newsChannel = interaction.options.getChannel("canal_noticias");
    const contextChannel1 = interaction.options.getChannel("canal_contexto_1");
    const contextChannel2 = interaction.options.getChannel("canal_contexto_2");
    const dailyQuestions = interaction.options.getInteger("preguntas_diarias");
    const askHour = interaction.options.getInteger("hora_preguntas");
    const publishHour = interaction.options.getInteger("hora_publicacion");
    const contextLookbackHours = interaction.options.getInteger("horas_contexto");
    const clearContext = interaction.options.getBoolean("borrar_contexto") ?? false;
    const timezone = interaction.options.getString("zona_horaria");

    const settings = await store.mutate((data) => {
      if (newsChannel) {
        data.settings.newsChannelId = newsChannel.id;
      }
      if (clearContext) {
        data.settings.contextChannelIds = [];
      } else if (contextChannel1 || contextChannel2) {
        const contextChannelIds = [...data.settings.contextChannelIds];
        if (contextChannel1) {
          contextChannelIds[0] = contextChannel1.id;
        }
        if (contextChannel2) {
          contextChannelIds[1] = contextChannel2.id;
        }
        data.settings.contextChannelIds = [...new Set(contextChannelIds.filter(Boolean))];
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
      if (contextLookbackHours !== null) {
        data.settings.contextLookbackHours = contextLookbackHours;
      }
      if (timezone) {
        data.settings.timezone = timezone.trim();
      }
      return data.settings;
    });

    await interaction.reply({
      content: [
        "Configuración del periodista actualizada.",
        `Canal de noticias: ${settings.newsChannelId ? `<#${settings.newsChannelId}>` : "sin configurar"}`,
        `Canales de contexto: ${formatChannelList(settings.contextChannelIds)}`,
        `Ventana de contexto: ${settings.contextLookbackHours} h`,
        `Preguntas diarias: ${settings.dailyQuestionCount}`,
        `Hora de preguntas: ${settings.askHour}:00`,
        `Hora de publicación: ${settings.publishHour}:00`,
        `Zona horaria: ${settings.timezone}`
      ].join("\n"),
      ephemeral: true
    });
    return;
  }

  if (subcommand === "preguntar-ahora") {
    await interaction.deferReply({ ephemeral: true });
    const user = interaction.options.getUser("usuario");
    const count = interaction.options.getInteger("cantidad");
    const result = user
      ? await askSpecificGm(client, store, user.id)
      : await askRandomGms(client, store, count ?? (await store.read()).settings.dailyQuestionCount);

    await interaction.editReply(
      `Preguntas por DM intentadas: ${result.attempted}. Enviadas: ${result.sent}. Fallidas: ${result.failed}.`
    );
    return;
  }

  if (subcommand === "publicar-ahora") {
    await interaction.deferReply({ ephemeral: true });
    const result = await publishNews(client, store);
    if (!result.posted) {
      await interaction.editReply(`No se ha publicado ningún artículo: ${result.reason}`);
      return;
    }

    await interaction.editReply(`Publicado "${result.title}" usando ${result.answersUsed} respuesta(s).`);
    return;
  }

  if (subcommand === "estado") {
    const data = await store.read();
    const activeGms = Object.values(data.gms).filter((gm) => gm.active).length;
    const pendingPrompts = data.prompts.filter((prompt) => prompt.status === "sent").length;
    await interaction.reply({
      content: [
        `GMs activos: ${activeGms}`,
        `Preguntas pendientes de respuesta: ${pendingPrompts}`,
        `Respuestas sin publicar: ${countUnpostedAnswers(data)}`,
        `Canal de noticias: ${data.settings.newsChannelId ? `<#${data.settings.newsChannelId}>` : "sin configurar"}`,
        `Canales de contexto: ${formatChannelList(data.settings.contextChannelIds)}`,
        `Ventana de contexto: ${data.settings.contextLookbackHours} h`,
        `Horario: pregunta a las ${data.settings.askHour}:00, publica a las ${data.settings.publishHour}:00 (${data.settings.timezone})`
      ].join("\n"),
      ephemeral: true
    });
  }
}
