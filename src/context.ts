import { type Channel, type Client, type Message } from "discord.js";
import type { BotSettings, GmRecord } from "./types.js";

const MAX_PAGES_PER_CHANNEL = 5;
const MAX_DIRECT_MESSAGES = 12;
const MAX_GENERAL_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 600;
export const MAX_CONTEXT_CHANNELS = 5;

export interface LeagueContextMessage {
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  mentionedUserIds: string[];
  content: string;
  createdAt: string;
  createdTimestamp: number;
  url: string;
}

export interface FranchiseContext {
  directMessages: LeagueContextMessage[];
  generalMessages: LeagueContextMessage[];
}

function isFetchableMessageChannel(channel: Channel | null): channel is Channel & {
  messages: {
    fetch: (options: { limit: number; before?: string }) => Promise<Map<string, Message>>;
  };
  name?: string;
} {
  return Boolean(channel?.isTextBased() && "messages" in channel);
}

function extractMessageText(message: Message): string {
  const embedText = message.embeds
    .flatMap((embed) => [embed.title, embed.description])
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");

  return [message.content, embedText]
    .filter((value) => value.trim())
    .join("\n")
    .replace(/<@!?\d+>/g, "@usuario")
    .replace(/<@&\d+>/g, "@rol")
    .replace(/<#\d+>/g, "#canal")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

function extractMentionedUserIds(message: Message): string[] {
  return [...message.content.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]).filter(Boolean);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTeamKeywords(gm: GmRecord): string[] {
  const normalizedTeam = normalizeText(gm.team);
  const teamWords = normalizedTeam.split(" ").filter((word) => word.length > 2);
  const significantWords = teamWords.filter((word) => !["los", "las", "the", "and"].includes(word));
  const lastWord = significantWords.at(-1);
  const twoWordNickname = significantWords.slice(-2).join(" ");
  const keywords = [
    normalizedTeam,
    twoWordNickname,
    lastWord,
    normalizeText(gm.displayName),
    gm.userId
  ].filter((value): value is string => Boolean(value && value.length > 2));

  return [...new Set(keywords)];
}

function messageMatchesGm(message: LeagueContextMessage, gm: GmRecord): boolean {
  const normalizedContent = normalizeText(message.content);
  const keywords = buildTeamKeywords(gm);

  return (
    message.authorId === gm.userId ||
    message.mentionedUserIds.includes(gm.userId) ||
    keywords.some((keyword) => normalizedContent.includes(keyword))
  );
}

async function fetchRecentChannelMessages(
  client: Client,
  channelId: string,
  lookbackMs: number
): Promise<LeagueContextMessage[]> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!isFetchableMessageChannel(channel)) {
    console.warn(`[context] Cannot read channel ${channelId}; it is not a fetchable text channel.`);
    return [];
  }

  const cutoff = Date.now() - lookbackMs;
  const messages: LeagueContextMessage[] = [];
  let before: string | undefined;

  for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page += 1) {
    const fetchOptions = before ? { limit: 100, before } : { limit: 100 };
    const fetched = await channel.messages.fetch(fetchOptions).catch((error) => {
      console.warn(`[context] Failed to fetch messages from ${channelId}:`, error);
      return null;
    });

    if (!fetched || fetched.size === 0) {
      break;
    }

    const pageMessages = [...fetched.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    for (const message of pageMessages) {
      if (message.createdTimestamp < cutoff) {
        continue;
      }

      const content = extractMessageText(message);
      if (!content) {
        continue;
      }

      messages.push({
        channelId,
        channelName: "name" in channel && channel.name ? channel.name : channelId,
        authorId: message.author.id,
        authorName: message.member?.displayName ?? message.author.username,
        mentionedUserIds: extractMentionedUserIds(message),
        content,
        createdAt: message.createdAt.toISOString(),
        createdTimestamp: message.createdTimestamp,
        url: message.url
      });
    }

    const oldest = pageMessages.at(-1);
    before = oldest?.id;
    if (!before || pageMessages.every((message) => message.createdTimestamp < cutoff)) {
      break;
    }
  }

  return messages;
}

export async function collectRecentLeagueMessages(
  client: Client,
  settings: BotSettings
): Promise<LeagueContextMessage[]> {
  const channelIds = [...new Set(settings.contextChannelIds)].filter(Boolean).slice(0, MAX_CONTEXT_CHANNELS);
  if (channelIds.length === 0) {
    return [];
  }

  const lookbackMs = Math.max(1, settings.contextLookbackHours) * 60 * 60 * 1000;
  const results = await Promise.all(
    channelIds.map((channelId) => fetchRecentChannelMessages(client, channelId, lookbackMs))
  );

  return results.flat().sort((a, b) => b.createdTimestamp - a.createdTimestamp);
}

export function buildFranchiseContext(messages: LeagueContextMessage[], gm: GmRecord): FranchiseContext {
  const directMessages = messages.filter((message) => messageMatchesGm(message, gm)).slice(0, MAX_DIRECT_MESSAGES);
  const directUrls = new Set(directMessages.map((message) => message.url));
  const generalMessages = messages
    .filter((message) => !directUrls.has(message.url))
    .slice(0, MAX_GENERAL_MESSAGES);

  return { directMessages, generalMessages };
}

export function contextSourceUrls(context: FranchiseContext): string[] {
  return [...new Set([...context.directMessages, ...context.generalMessages].map((message) => message.url))];
}

export function formatContextMessages(messages: LeagueContextMessage[]): string {
  return messages
    .map((message) => {
      return `[${message.createdAt} #${message.channelName} ${message.authorName}] ${message.content}`;
    })
    .join("\n");
}
