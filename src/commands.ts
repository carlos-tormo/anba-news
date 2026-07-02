import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { randomUUID } from "node:crypto";
import { env } from "./config.js";
import { MAX_CONTEXT_CHANNELS } from "./context.js";
import { askRandomGms, askSpecificGm, countUnpostedAnswers, publishNews } from "./journalist.js";
import { moderateSubmission } from "./moderation.js";
import type { JsonStore } from "./store.js";
import { getZonedNow } from "./time.js";
import { formatTradeSearchSummary, searchTradeHistory } from "./trade-search.js";

function formatChannelList(channelIds: string[]): string {
  return channelIds.length > 0 ? channelIds.map((channelId) => `<#${channelId}>`).join(", ") : "sin configurar";
}

function formatLastAskRun(data: Awaited<ReturnType<JsonStore["read"]>>): string {
  if (!data.lastRun.askedDate) {
    return "nunca";
  }

  const stats =
    data.lastRun.askedAttempted !== undefined
      ? `; enviadas ${data.lastRun.askedSent ?? 0}/${data.lastRun.askedAttempted}, fallidas ${data.lastRun.askedFailed ?? 0}`
      : "";

  return `${data.lastRun.askedDate}${data.lastRun.askedAt ? ` (${data.lastRun.askedAt}${stats})` : ""}`;
}

function formatLastPublishRun(data: Awaited<ReturnType<JsonStore["read"]>>): string {
  if (!data.lastRun.publishedDate) {
    return "nunca";
  }

  const status =
    data.lastRun.publishedPosted === undefined
      ? ""
      : data.lastRun.publishedPosted
        ? "; publicada"
        : `; omitida${data.lastRun.publishedReason ? `: ${data.lastRun.publishedReason}` : ""}`;

  return `${data.lastRun.publishedDate}${data.lastRun.publishedAt ? ` (${data.lastRun.publishedAt}${status})` : ""}`;
}

function getInteractionDisplayName(interaction: ChatInputCommandInteraction): string {
  return interaction.member && "displayName" in interaction.member && typeof interaction.member.displayName === "string"
    ? interaction.member.displayName
    : interaction.user.globalName ?? interaction.user.username;
}

function isBotAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (env.botAdminUserIds.length > 0) {
    return env.botAdminUserIds.includes(interaction.user.id);
  }

  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

async function requireBotAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isBotAdmin(interaction)) {
    return true;
  }

  await interaction.reply({
    content: "Solo el administrador del bot puede usar este comando.",
    ephemeral: true
  });
  return false;
}

const gmCommand = new SlashCommandBuilder()
  .setName("gm")
  .setDescription("Gestiona los GMs de la liga NBA2K.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("asignar")
      .setDescription("Registra o actualiza un GM.")
      .addUserOption((option) => option.setName("usuario").setDescription("Usuario de Discord.").setRequired(true))
      .addStringOption((option) => option.setName("equipo").setDescription("Nombre de la franquicia.").setRequired(true))
      .addStringOption((option) =>
        option.setName("codigo_equipo").setDescription("Código del equipo en ANBA Excel, ej. LAL.").setMaxLength(8)
      )
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
      .addChannelOption((option) =>
        option
          .setName("canal_contexto_3")
          .setDescription("Tercer canal para leer contexto reciente.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addChannelOption((option) =>
        option
          .setName("canal_contexto_4")
          .setDescription("Cuarto canal para leer contexto reciente.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addChannelOption((option) =>
        option
          .setName("canal_contexto_5")
          .setDescription("Quinto canal para leer contexto reciente.")
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
  .addSubcommand((subcommand) =>
    subcommand
      .setName("buscar-trade")
      .setDescription("Busca traspasos u operaciones en los canales de contexto.")
      .addStringOption((option) =>
        option
          .setName("consulta")
          .setDescription('Pregunta natural, ej. "trade donde New York y Chicago están involucrados".')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(300)
      )
      .addIntegerOption((option) =>
        option
          .setName("dias")
          .setDescription("Días hacia atrás para buscar. Por defecto 365.")
          .setMinValue(1)
          .setMaxValue(3650)
      )
      .addIntegerOption((option) =>
        option
          .setName("resultados")
          .setDescription("Número máximo de resultados. Por defecto 5.")
          .setMinValue(1)
          .setMaxValue(10)
      )
  )
  .addSubcommand((subcommand) => subcommand.setName("publicar-ahora").setDescription("Publica noticias con respuestas pendientes."))
  .addSubcommand((subcommand) => subcommand.setName("estado").setDescription("Muestra el estado del periodista."));

const rumorCommand = new SlashCommandBuilder()
  .setName("rumor")
  .setDescription("Filtra un rumor a la redacción del periodista.")
  .addStringOption((option) =>
    option
      .setName("texto")
      .setDescription("Rumor que quieres filtrar. Puede ser verdadero o falso.")
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(600)
  )
  .addStringOption((option) =>
    option.setName("equipo").setDescription("Equipo relacionado, si hay uno concreto.").setMaxLength(80)
  );

const submittedQuestionCommand = new SlashCommandBuilder()
  .setName("pregunta")
  .setDescription("Propón una pregunta para que el periodista se la haga a un GM.")
  .addUserOption((option) =>
    option.setName("destino").setDescription("GM/equipo al que va dirigida la pregunta.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("texto")
      .setDescription("Pregunta que quieres proponer.")
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(500)
  );

export const commandPayloads = [
  gmCommand.toJSON(),
  journalistCommand.toJSON(),
  rumorCommand.toJSON(),
  submittedQuestionCommand.toJSON()
];

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
    if (!(await requireBotAdmin(interaction))) {
      return;
    }
    await handleGmCommand(interaction, store);
    return;
  }

  if (interaction.commandName === "periodista") {
    if (!(await requireBotAdmin(interaction))) {
      return;
    }
    await handleJournalistCommand(interaction, client, store);
    return;
  }

  if (interaction.commandName === "rumor") {
    await handleRumorCommand(interaction, store);
    return;
  }

  if (interaction.commandName === "pregunta") {
    await handleSubmittedQuestionCommand(interaction, store);
  }
}

async function handleGmCommand(interaction: ChatInputCommandInteraction, store: JsonStore): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "asignar") {
    const user = interaction.options.getUser("usuario", true);
    const team = interaction.options.getString("equipo", true).trim();
    const teamCode = interaction.options.getString("codigo_equipo")?.trim().toUpperCase();
    const member = await interaction.guild?.members.fetch(user.id).catch(() => undefined);
    const displayName = member?.displayName ?? user.username;

    const gm = await store.mutate((data) => {
      const existing = data.gms[user.id];
      const previousTeamCode = existing?.team === team ? existing.teamCode : undefined;
      data.gms[user.id] = {
        userId: user.id,
        team,
        teamCode: teamCode || previousTeamCode,
        displayName,
        active: true,
        addedAt: existing?.addedAt ?? new Date().toISOString()
      };
      return data.gms[user.id];
    });

    await interaction.reply({
      content: `${displayName} queda registrado como GM de ${team}${gm.teamCode ? ` (${gm.teamCode})` : ""}.`,
      ephemeral: true
    });
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
      ? gms.map((gm) => `- ${gm.displayName}: ${gm.team}${gm.teamCode ? ` (${gm.teamCode})` : ""}`).join("\n")
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
    const contextChannels = Array.from({ length: MAX_CONTEXT_CHANNELS }, (_, index) =>
      interaction.options.getChannel(`canal_contexto_${index + 1}`)
    );
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
      } else if (contextChannels.some(Boolean)) {
        const contextChannelIds = [...data.settings.contextChannelIds].slice(0, MAX_CONTEXT_CHANNELS);
        contextChannels.forEach((channel, index) => {
          if (channel) {
            contextChannelIds[index] = channel.id;
          }
        });
        data.settings.contextChannelIds = [...new Set(contextChannelIds.filter(Boolean))].slice(0, MAX_CONTEXT_CHANNELS);
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

    await interaction.editReply(
      `Publicado "${result.title}" usando ${result.answersUsed} respuesta(s) y ${result.rumorsUsed} rumor(es).`
    );
    return;
  }

  if (subcommand === "buscar-trade") {
    await interaction.deferReply({ ephemeral: true });
    const query = interaction.options.getString("consulta", true);
    const days = interaction.options.getInteger("dias");
    const limit = interaction.options.getInteger("resultados");
    const data = await store.read();
    const result = await searchTradeHistory(client, data.settings, { query, days, limit });
    await interaction.editReply({
      content: formatTradeSearchSummary(result),
      allowedMentions: { parse: [] }
    });
    return;
  }

  if (subcommand === "estado") {
    const data = await store.read();
    const activeGmRecords = Object.values(data.gms).filter((gm) => gm.active);
    const activeGms = activeGmRecords.length;
    const gmsWithTeamCode = activeGmRecords.filter((gm) => gm.teamCode).length;
    const pendingPrompts = data.prompts.filter((prompt) => prompt.status === "sent").length;
    const usersWithOpenPrompts = new Set(data.prompts.filter((prompt) => prompt.status === "sent").map((prompt) => prompt.userId));
    const eligibleGms = activeGmRecords.filter((gm) => !usersWithOpenPrompts.has(gm.userId)).length;
    const usedRumorIds = new Set(data.articles.flatMap((article) => article.sourceRumorIds ?? []));
    const pendingRumors = data.rumors.filter((rumor) => rumor.status === "accepted" && !usedRumorIds.has(rumor.id)).length;
    const pendingCommunityQuestions = data.submittedQuestions.filter((question) => question.status === "accepted").length;
    await interaction.reply({
      content: [
        `GMs activos: ${activeGms}`,
        `GMs elegibles ahora: ${eligibleGms}`,
        `Preguntas diarias: ${data.settings.dailyQuestionCount}`,
        `Preguntas pendientes de respuesta: ${pendingPrompts}`,
        `Respuestas sin publicar: ${countUnpostedAnswers(data)}`,
        `Rumores aceptados: ${pendingRumors}`,
        `Preguntas de comunidad en cola: ${pendingCommunityQuestions}`,
        `Contexto ANBA Excel: ${env.anbaExcelBaseUrl ? `configurado (${gmsWithTeamCode}/${activeGms} GMs con código)` : "sin configurar"}`,
        `Canal de noticias: ${data.settings.newsChannelId ? `<#${data.settings.newsChannelId}>` : "sin configurar"}`,
        `Canales de contexto: ${formatChannelList(data.settings.contextChannelIds)}`,
        `Ventana de contexto: ${data.settings.contextLookbackHours} h`,
        `Horario: pregunta a las ${data.settings.askHour}:00, publica a las ${data.settings.publishHour}:00 (${data.settings.timezone})`,
        `Última ronda programada: ${formatLastAskRun(data)}`,
        `Última publicación programada: ${formatLastPublishRun(data)}`
      ].join("\n"),
      ephemeral: true
    });
  }
}

async function handleRumorCommand(interaction: ChatInputCommandInteraction, store: JsonStore): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Este comando solo se puede usar dentro del servidor.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const text = interaction.options.getString("texto", true).trim();
  const team = interaction.options.getString("equipo")?.trim();
  const data = await store.read();
  const dateKey = getZonedNow(data.settings.timezone).dateKey;

  const alreadySubmittedToday = data.rumors.some((rumor) => {
    return rumor.userId === interaction.user.id && rumor.dateKey === dateKey && rumor.status === "accepted";
  });

  if (alreadySubmittedToday) {
    await interaction.editReply("Ya has filtrado un rumor hoy. Puedes volver a enviar otro mañana.");
    return;
  }

  const moderation = await moderateSubmission("rumor", text);
  await store.mutate((latest) => {
    latest.rumors.push({
      id: randomUUID(),
      userId: interaction.user.id,
      userDisplayName: getInteractionDisplayName(interaction),
      team: team || undefined,
      text,
      status: moderation.accepted ? "accepted" : "rejected",
      moderationReason: moderation.reason,
      dateKey,
      createdAt: new Date().toISOString()
    });
  });

  if (!moderation.accepted) {
    await interaction.editReply(`No puedo pasar este rumor a la redacción: ${moderation.reason ?? "no supera el filtro."}`);
    return;
  }

  await interaction.editReply("Rumor recibido. La redacción podrá usarlo como material no verificado en próximas noticias.");
}

async function handleSubmittedQuestionCommand(
  interaction: ChatInputCommandInteraction,
  store: JsonStore
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Este comando solo se puede usar dentro del servidor.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser("destino", true);
  const question = interaction.options.getString("texto", true).trim();
  const data = await store.read();
  const targetGm = data.gms[target.id];
  const dateKey = getZonedNow(data.settings.timezone).dateKey;

  if (!targetGm || !targetGm.active) {
    await interaction.editReply("El destino debe ser un GM registrado y activo.");
    return;
  }

  const moderation = await moderateSubmission("question", question);
  await store.mutate((latest) => {
    latest.submittedQuestions.push({
      id: randomUUID(),
      userId: interaction.user.id,
      userDisplayName: getInteractionDisplayName(interaction),
      targetUserId: target.id,
      targetDisplayName: targetGm.displayName,
      targetTeam: targetGm.team,
      question,
      status: moderation.accepted ? "accepted" : "rejected",
      moderationReason: moderation.reason,
      dateKey,
      createdAt: new Date().toISOString()
    });
  });

  if (!moderation.accepted) {
    await interaction.editReply(`No puedo guardar esta pregunta: ${moderation.reason ?? "no supera el filtro."}`);
    return;
  }

  await interaction.editReply(
    `Pregunta guardada para ${targetGm.team}. El periodista podrá considerarla a partir de mañana.`
  );
}
