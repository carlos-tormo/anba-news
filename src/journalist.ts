import {
  type Channel,
  type Client,
  type DMChannel,
  type Message,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import { randomUUID } from "node:crypto";
import { env } from "./config.js";
import {
  buildFranchiseContext,
  collectRecentLeagueMessages,
  contextSourceUrls,
  type LeagueContextMessage
} from "./context.js";
import { chunkDiscordMessage } from "./messages.js";
import { generateArticle } from "./news.js";
import { loadQuestionBank, pickRandomQuestion, renderQuestion } from "./questions.js";
import { writeQuestion } from "./question-writer.js";
import { dateKeyForIso, getZonedNow } from "./time.js";
import type { AnswerForArticle, BotData, GmRecord, PromptRecord } from "./types.js";
import type { JsonStore } from "./store.js";

export interface AskResult {
  attempted: number;
  sent: number;
  failed: number;
}

export interface PublishResult {
  posted: boolean;
  reason?: string;
  title?: string;
  answersUsed: number;
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function hasOpenPrompt(data: BotData, userId: string): boolean {
  return data.prompts.some((prompt) => prompt.userId === userId && prompt.status === "sent");
}

function selectGms(data: BotData, count: number): GmRecord[] {
  const eligible = Object.values(data.gms).filter((gm) => gm.active && !hasOpenPrompt(data, gm.userId));
  return shuffle(eligible).slice(0, count);
}

function latestOpenPrompt(data: BotData, userId: string): PromptRecord | undefined {
  return [...data.prompts]
    .reverse()
    .find((prompt) => prompt.userId === userId && prompt.status === "sent");
}

async function sendQuestion(
  client: Client,
  store: JsonStore,
  gm: GmRecord,
  leagueMessages: LeagueContextMessage[]
): Promise<boolean> {
  const questions = await loadQuestionBank();
  const template = pickRandomQuestion(questions);
  const franchiseContext = buildFranchiseContext(leagueMessages, gm);
  let writtenQuestion = {
    category: template.category,
    question: renderQuestion(template, gm)
  };

  try {
    writtenQuestion = await writeQuestion(gm, template, franchiseContext);
  } catch (error) {
    console.warn(`[question] Failed to generate contextual question for ${gm.team}:`, error);
  }

  const prompt: PromptRecord = {
    id: randomUUID(),
    userId: gm.userId,
    team: gm.team,
    category: writtenQuestion.category,
    question: writtenQuestion.question,
    status: "created",
    sentAt: new Date().toISOString(),
    contextMessageUrls: contextSourceUrls(franchiseContext)
  };

  await store.mutate((data) => {
    data.prompts.push(prompt);
  });

  try {
    const user = await client.users.fetch(gm.userId);
    await user.send(
      [
        `**${env.journalistName}**`,
        `Pregunta rápida para la dirección deportiva de ${gm.team}:`,
        "",
        prompt.question,
        "",
        "Responde directamente a este DM y podría usar tu respuesta en las noticias de la liga."
      ].join("\n")
    );

    await store.mutate((data) => {
      const existing = data.prompts.find((item) => item.id === prompt.id);
      if (existing) {
        existing.status = "sent";
        existing.sentAt = new Date().toISOString();
      }
    });
    return true;
  } catch (error) {
    await store.mutate((data) => {
      const existing = data.prompts.find((item) => item.id === prompt.id);
      if (existing) {
        existing.status = "failed";
        existing.error = error instanceof Error ? error.message : String(error);
      }
    });
    return false;
  }
}

export async function askRandomGms(client: Client, store: JsonStore, count: number): Promise<AskResult> {
  const data = await store.read();
  const selected = selectGms(data, count);
  const leagueMessages = await collectRecentLeagueMessages(client, data.settings);
  let sent = 0;
  let failed = 0;

  for (const gm of selected) {
    const ok = await sendQuestion(client, store, gm, leagueMessages);
    if (ok) {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return { attempted: selected.length, sent, failed };
}

export async function askSpecificGm(client: Client, store: JsonStore, userId: string): Promise<AskResult> {
  const data = await store.read();
  const gm = data.gms[userId];

  if (!gm || !gm.active || hasOpenPrompt(data, userId)) {
    return { attempted: 0, sent: 0, failed: 0 };
  }

  const leagueMessages = await collectRecentLeagueMessages(client, data.settings);
  const ok = await sendQuestion(client, store, gm, leagueMessages);
  return { attempted: 1, sent: ok ? 1 : 0, failed: ok ? 0 : 1 };
}

export async function handleDmAnswer(message: Message, store: JsonStore): Promise<void> {
  if (message.author.bot || message.guildId) {
    return;
  }

  const answer = message.content.trim();
  if (!answer) {
    return;
  }

  const updated = await store.mutate((data) => {
    const prompt = latestOpenPrompt(data, message.author.id);
    if (!prompt) {
      return false;
    }

    prompt.status = "answered";
    prompt.answer = answer;
    prompt.answeredAt = new Date().toISOString();
    return true;
  });

  if (updated) {
    await message.reply("Recibido. Podría usarlo en la próxima publicación de noticias de la liga.");
  } else {
    await message.reply("Ahora mismo no tengo ninguna pregunta abierta para ti.");
  }
}

function getUnpostedAnswers(data: BotData): AnswerForArticle[] {
  const usedPromptIds = new Set(data.articles.flatMap((article) => article.sourcePromptIds));

  return data.prompts
    .filter((prompt) => prompt.status === "answered" && prompt.answer && !usedPromptIds.has(prompt.id))
    .map((prompt) => ({
      promptId: prompt.id,
      team: prompt.team,
      question: prompt.question,
      answer: prompt.answer ?? ""
    }));
}

function isSendableTextChannel(channel: Channel | null): channel is TextChannel | NewsChannel | DMChannel {
  return Boolean(channel?.isTextBased());
}

export async function publishNews(client: Client, store: JsonStore): Promise<PublishResult> {
  const data = await store.read();
  const channelId = data.settings.newsChannelId;

  if (!channelId) {
    return { posted: false, reason: "No hay ningún canal de noticias configurado.", answersUsed: 0 };
  }

  const answers = getUnpostedAnswers(data);
  if (answers.length === 0) {
    return { posted: false, reason: "No hay respuestas de GMs pendientes de publicar.", answersUsed: 0 };
  }

  const channel = await client.channels.fetch(channelId);
  if (!isSendableTextChannel(channel)) {
    return { posted: false, reason: "El canal de noticias configurado no permite enviar mensajes de texto.", answersUsed: 0 };
  }

  const article = await generateArticle(answers);
  const content = [`# ${article.title}`, article.body].join("\n\n");
  const messageIds: string[] = [];

  for (const chunk of chunkDiscordMessage(content)) {
    const posted = await channel.send(chunk);
    messageIds.push(posted.id);
  }

  const dateKey = getZonedNow(data.settings.timezone).dateKey;
  await store.mutate((latest) => {
    latest.articles.push({
      id: randomUUID(),
      dateKey,
      title: article.title,
      body: article.body,
      sourcePromptIds: answers.map((answer) => answer.promptId),
      postedAt: new Date().toISOString(),
      messageIds
    });
  });

  return { posted: true, title: article.title, answersUsed: answers.length };
}

export async function markAskedToday(store: JsonStore): Promise<void> {
  await store.mutate((data) => {
    data.lastRun.askedDate = getZonedNow(data.settings.timezone).dateKey;
  });
}

export async function markPublishedToday(store: JsonStore): Promise<void> {
  await store.mutate((data) => {
    data.lastRun.publishedDate = getZonedNow(data.settings.timezone).dateKey;
  });
}

export function countUnpostedAnswers(data: BotData): number {
  return getUnpostedAnswers(data).length;
}

export function countAnswersForToday(data: BotData): number {
  const today = getZonedNow(data.settings.timezone).dateKey;
  return data.prompts.filter((prompt) => {
    return prompt.status === "answered" && prompt.answeredAt && dateKeyForIso(prompt.answeredAt, data.settings.timezone) === today;
  }).length;
}
