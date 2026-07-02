import { type Channel, type Client, type Message } from "discord.js";
import { MAX_CONTEXT_CHANNELS } from "./context.js";
import type { BotSettings } from "./types.js";

const DEFAULT_SEARCH_DAYS = 365;
const MAX_SEARCH_DAYS = 3650;
const DEFAULT_RESULT_LIMIT = 5;
const MAX_RESULT_LIMIT = 10;
const MAX_SEARCH_PAGES_PER_CHANNEL = 30;
const SEARCH_MESSAGE_CHARS = 1_500;
const RESULT_SNIPPET_CHARS = 340;

type SearchableMessageChannel = Channel & {
  messages: {
    fetch: (options: { limit: number; before?: string }) => Promise<Map<string, Message>>;
  };
  name?: string;
};

interface TeamAlias {
  code: string;
  aliases: string[];
}

interface SearchIntent {
  query: string;
  normalizedQuery: string;
  teamGroups: SearchGroup[];
  yearGroups: SearchGroup[];
  draftGroups: SearchGroup[];
  keywords: string[];
}

interface SearchGroup {
  label: string;
  terms: string[];
}

interface CandidateMessage {
  channelId: string;
  channelName: string;
  authorName: string;
  content: string;
  createdAt: string;
  createdTimestamp: number;
  url: string;
}

export interface TradeSearchOptions {
  query: string;
  days?: number | null;
  limit?: number | null;
}

export interface TradeSearchResult {
  channelId: string;
  channelName: string;
  authorName: string;
  createdAt: string;
  createdTimestamp: number;
  url: string;
  content: string;
  score: number;
  matchedLabels: string[];
}

export interface TradeSearchSummary {
  query: string;
  days: number;
  limit: number;
  channelIds: string[];
  scannedChannels: number;
  scannedMessages: number;
  reachedPageLimit: boolean;
  results: TradeSearchResult[];
}

const TEAM_ALIASES: TeamAlias[] = [
  { code: "ATL", aliases: ["atl", "atlanta", "atlanta hawks", "hawks"] },
  { code: "BKN", aliases: ["bkn", "brooklyn", "brooklyn nets", "nets"] },
  { code: "BOS", aliases: ["bos", "boston", "boston celtics", "celtics"] },
  { code: "CHA", aliases: ["cha", "charlotte", "charlotte hornets", "hornets"] },
  { code: "CHI", aliases: ["chi", "chicago", "chicago bulls", "bulls"] },
  { code: "CLE", aliases: ["cle", "cleveland", "cleveland cavaliers", "cavaliers", "cavs"] },
  { code: "DAL", aliases: ["dal", "dallas", "dallas mavericks", "mavericks", "mavs"] },
  { code: "DEN", aliases: ["den", "denver", "denver nuggets", "nuggets"] },
  { code: "DET", aliases: ["det", "detroit", "detroit pistons", "pistons"] },
  { code: "GSW", aliases: ["gsw", "golden state", "golden state warriors", "warriors"] },
  { code: "HOU", aliases: ["hou", "houston", "houston rockets", "rockets"] },
  { code: "IND", aliases: ["ind", "indiana", "indiana pacers", "pacers"] },
  { code: "LAC", aliases: ["lac", "la clippers", "los angeles clippers", "clippers"] },
  { code: "LAL", aliases: ["lal", "la lakers", "los angeles lakers", "lakers"] },
  { code: "MEM", aliases: ["mem", "memphis", "memphis grizzlies", "grizzlies"] },
  { code: "MIA", aliases: ["mia", "miami", "miami heat", "heat"] },
  { code: "MIL", aliases: ["milwaukee", "milwaukee bucks", "bucks"] },
  { code: "MIN", aliases: ["min", "minnesota", "minnesota timberwolves", "timberwolves", "wolves"] },
  { code: "NOP", aliases: ["nop", "new orleans", "new orleans pelicans", "pelicans", "pels"] },
  { code: "NYK", aliases: ["nyk", "new york", "nueva york", "new york knicks", "knicks"] },
  { code: "OKC", aliases: ["okc", "oklahoma city", "oklahoma city thunder", "thunder"] },
  { code: "ORL", aliases: ["orl", "orlando", "orlando magic", "magic"] },
  { code: "PHI", aliases: ["phi", "philadelphia", "philadelphia 76ers", "sixers", "76ers"] },
  { code: "PHX", aliases: ["phx", "phoenix", "phoenix suns", "suns"] },
  { code: "POR", aliases: ["portland", "portland trailblazers", "portland trail blazers", "blazers"] },
  { code: "SAC", aliases: ["sac", "sacramento", "sacramento kings", "kings"] },
  { code: "SAS", aliases: ["sas", "san antonio", "san antonio spurs", "spurs"] },
  { code: "TOR", aliases: ["tor", "toronto", "toronto raptors", "raptors"] },
  { code: "UTA", aliases: ["uta", "utah", "utah jazz", "jazz"] },
  { code: "WAS", aliases: ["washington", "washington wizards", "wizards"] }
];

const STOP_WORDS = new Set([
  "a",
  "al",
  "alguna",
  "algun",
  "and",
  "are",
  "buscar",
  "busca",
  "buscame",
  "canal",
  "canales",
  "channel",
  "channels",
  "con",
  "de",
  "deal",
  "dealt",
  "del",
  "donde",
  "el",
  "en",
  "encuentra",
  "entre",
  "equipo",
  "equipos",
  "estos",
  "find",
  "from",
  "in",
  "involved",
  "involucrado",
  "involucrados",
  "involucran",
  "jugador",
  "jugadores",
  "la",
  "las",
  "league",
  "liga",
  "los",
  "me",
  "mi",
  "o",
  "operacion",
  "operaciones",
  "or",
  "que",
  "se",
  "these",
  "trade",
  "traded",
  "traspaso",
  "traspasos",
  "un",
  "una",
  "where",
  "y"
]);

const TRADE_TERMS = [
  "adquiere",
  "adquieren",
  "cambio",
  "deal",
  "dealt",
  "envia",
  "enviado",
  "enviados",
  "intercambio",
  "manda",
  "mandan",
  "movimiento",
  "operacion",
  "recibe",
  "reciben",
  "sale",
  "traspasa",
  "traspasado",
  "traspasan",
  "traspaso",
  "trade",
  "traded"
];

function isFetchableMessageChannel(channel: Channel | null): channel is SearchableMessageChannel {
  return Boolean(channel?.isTextBased() && "messages" in channel);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[ª]/g, "a")
    .replace(/[º]/g, "o")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseMatches(normalizedText: string, normalizedPhrase: string): boolean {
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function extractMessageText(message: Message): string {
  const embedText = message.embeds
    .flatMap((embed) => [embed.title, embed.description, ...embed.fields.flatMap((field) => [field.name, field.value])])
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
    .slice(0, SEARCH_MESSAGE_CHARS);
}

function buildTeamGroups(normalizedQuery: string): SearchGroup[] {
  return TEAM_ALIASES.flatMap((team) => {
    const normalizedAliases = team.aliases.map(normalizeText);
    const matched = normalizedAliases.some((alias) => alias.length > 1 && phraseMatches(normalizedQuery, alias));
    if (!matched) {
      return [];
    }

    return [{ label: team.code, terms: [...new Set([team.code.toLowerCase(), ...normalizedAliases])] }];
  });
}

function buildYearGroups(normalizedQuery: string): SearchGroup[] {
  return [...new Set(normalizedQuery.match(/\b20[2-4]\d\b/g) ?? [])].map((year) => ({
    label: year,
    terms: [year]
  }));
}

function buildDraftGroups(normalizedQuery: string): SearchGroup[] {
  const groups: SearchGroup[] = [];
  if (/\b(1|1a|1o|1st|first|primera)\b/.test(normalizedQuery)) {
    groups.push({ label: "1ª ronda", terms: ["1 ronda", "1a ronda", "1o ronda", "1st", "first", "primera"] });
  }
  if (/\b(2|2a|2o|2nd|second|segunda)\b/.test(normalizedQuery)) {
    groups.push({ label: "2ª ronda", terms: ["2 ronda", "2a ronda", "2o ronda", "2nd", "second", "segunda"] });
  }
  return groups;
}

function removeTeamAliases(normalizedQuery: string, teamGroups: SearchGroup[]): string {
  let cleaned = ` ${normalizedQuery} `;
  const aliasesToRemove = teamGroups.flatMap((group) => group.terms).sort((a, b) => b.length - a.length);

  for (const alias of aliasesToRemove) {
    cleaned = cleaned.replaceAll(` ${alias} `, " ");
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

export function buildTradeSearchIntent(query: string): SearchIntent {
  const normalizedQuery = normalizeText(query);
  const teamGroups = buildTeamGroups(normalizedQuery);
  const yearGroups = buildYearGroups(normalizedQuery);
  const draftGroups = buildDraftGroups(normalizedQuery);
  const queryWithoutTeams = removeTeamAliases(normalizedQuery, teamGroups);
  const keywords = [...new Set(queryWithoutTeams.split(" "))]
    .filter((word) => word.length > 2 || /^\d+$/.test(word))
    .filter((word) => !STOP_WORDS.has(word))
    .filter((word) => !TRADE_TERMS.includes(word))
    .filter((word) => !yearGroups.some((group) => group.terms.includes(word)));

  return { query, normalizedQuery, teamGroups, yearGroups, draftGroups, keywords };
}

function matchingLabels(normalizedContent: string, groups: SearchGroup[]): string[] {
  return groups
    .filter((group) => group.terms.some((term) => phraseMatches(normalizedContent, normalizeText(term))))
    .map((group) => group.label);
}

function scoreMessage(message: CandidateMessage, intent: SearchIntent): TradeSearchResult | null {
  const normalizedContent = normalizeText(message.content);
  const matchedTeams = matchingLabels(normalizedContent, intent.teamGroups);
  const matchedYears = matchingLabels(normalizedContent, intent.yearGroups);
  const matchedDraft = matchingLabels(normalizedContent, intent.draftGroups);
  const matchedKeywords = intent.keywords.filter((keyword) => phraseMatches(normalizedContent, keyword));
  const matchedTradeTerms = TRADE_TERMS.filter((term) => phraseMatches(normalizedContent, term));

  if (matchedTeams.length < intent.teamGroups.length) {
    return null;
  }
  if (matchedYears.length < intent.yearGroups.length) {
    return null;
  }

  const minimumKeywordMatches =
    intent.teamGroups.length > 0 || intent.yearGroups.length > 0
      ? 0
      : Math.min(intent.keywords.length, Math.max(1, Math.ceil(intent.keywords.length * 0.6)));
  if (matchedKeywords.length < minimumKeywordMatches) {
    return null;
  }

  if (
    intent.teamGroups.length === 0 &&
    intent.yearGroups.length === 0 &&
    intent.keywords.length === 0 &&
    matchedTradeTerms.length === 0
  ) {
    return null;
  }

  const score =
    matchedTeams.length * 9 +
    matchedYears.length * 5 +
    matchedDraft.length * 3 +
    matchedKeywords.length * 4 +
    Math.min(matchedTradeTerms.length, 3) * 2;

  if (score <= 0) {
    return null;
  }

  return {
    ...message,
    score,
    matchedLabels: [...new Set([...matchedTeams, ...matchedYears, ...matchedDraft, ...matchedKeywords])]
  };
}

function normalizeSearchDays(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_SEARCH_DAYS;
  }

  return Math.min(MAX_SEARCH_DAYS, Math.max(1, Math.floor(value)));
}

function normalizeResultLimit(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_RESULT_LIMIT;
  }

  return Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.floor(value)));
}

async function fetchChannelMessagesForSearch(
  client: Client,
  channelId: string,
  cutoffMs: number
): Promise<{ messages: CandidateMessage[]; reachedPageLimit: boolean }> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!isFetchableMessageChannel(channel)) {
    console.warn(`[trade-search] Cannot read channel ${channelId}; it is not a fetchable text channel.`);
    return { messages: [], reachedPageLimit: false };
  }

  const messages: CandidateMessage[] = [];
  let before: string | undefined;
  let reachedPageLimit = false;

  for (let page = 0; page < MAX_SEARCH_PAGES_PER_CHANNEL; page += 1) {
    const fetched = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 }).catch((error) => {
      console.warn(`[trade-search] Failed to fetch messages from ${channelId}:`, error);
      return null;
    });

    if (!fetched || fetched.size === 0) {
      break;
    }

    const pageMessages = [...fetched.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    for (const message of pageMessages) {
      if (message.createdTimestamp < cutoffMs) {
        continue;
      }

      const content = extractMessageText(message);
      if (!content) {
        continue;
      }

      messages.push({
        channelId,
        channelName: channel.name ?? channelId,
        authorName: message.member?.displayName ?? message.author.username,
        content,
        createdAt: message.createdAt.toISOString(),
        createdTimestamp: message.createdTimestamp,
        url: message.url
      });
    }

    const oldest = pageMessages.at(-1);
    before = oldest?.id;
    if (!before || pageMessages.every((message) => message.createdTimestamp < cutoffMs)) {
      break;
    }
    reachedPageLimit = page === MAX_SEARCH_PAGES_PER_CHANNEL - 1;
  }

  return { messages, reachedPageLimit };
}

export async function searchTradeHistory(
  client: Client,
  settings: BotSettings,
  options: TradeSearchOptions
): Promise<TradeSearchSummary> {
  const query = options.query.trim();
  const days = normalizeSearchDays(options.days);
  const limit = normalizeResultLimit(options.limit);
  const channelIds = [...new Set(settings.contextChannelIds)].filter(Boolean).slice(0, MAX_CONTEXT_CHANNELS);
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const intent = buildTradeSearchIntent(query);

  const channelResults = await Promise.all(
    channelIds.map((channelId) => fetchChannelMessagesForSearch(client, channelId, cutoffMs))
  );
  const candidates = channelResults.flatMap((result) => result.messages);
  const results = candidates
    .map((message) => scoreMessage(message, intent))
    .filter((result): result is TradeSearchResult => Boolean(result))
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return b.createdTimestamp - a.createdTimestamp;
    })
    .slice(0, limit);

  return {
    query,
    days,
    limit,
    channelIds,
    scannedChannels: channelIds.length,
    scannedMessages: candidates.length,
    reachedPageLimit: channelResults.some((result) => result.reachedPageLimit),
    results
  };
}

function escapeInlineCode(text: string): string {
  return text.replace(/`/g, "'");
}

function sanitizeDiscordText(text: string): string {
  return text.replace(/@/g, "@\u200b").replace(/\s+/g, " ").trim();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid"
  }).format(new Date(value));
}

function formatResult(result: TradeSearchResult, index: number): string {
  const labels = result.matchedLabels.length > 0 ? ` · ${result.matchedLabels.join(", ")}` : "";
  const snippet = sanitizeDiscordText(result.content).slice(0, RESULT_SNIPPET_CHARS);
  return [
    `**${index + 1}. #${result.channelName} · ${formatDate(result.createdAt)}${labels}**`,
    `<${result.url}>`,
    `> ${snippet}${snippet.length >= RESULT_SNIPPET_CHARS ? "…" : ""}`
  ].join("\n");
}

export function formatTradeSearchSummary(summary: TradeSearchSummary): string {
  const channelList =
    summary.channelIds.length > 0 ? summary.channelIds.map((channelId) => `<#${channelId}>`).join(", ") : "sin configurar";
  const header = [
    "**Búsqueda de traspasos**",
    `Consulta: \`${escapeInlineCode(summary.query)}\``,
    `Canales: ${channelList}`,
    `Ventana: ${summary.days} días · mensajes revisados: ${summary.scannedMessages}`,
    summary.reachedPageLimit
      ? "_Aviso: se llegó al límite de paginación en algún canal; puede haber mensajes más antiguos sin revisar._"
      : undefined
  ].filter(Boolean);

  if (summary.channelIds.length === 0) {
    return [
      ...header,
      "",
      "No hay canales de contexto configurados. Añade canales con `/periodista configurar canal_contexto_1:#canal ...`."
    ].join("\n");
  }

  if (summary.results.length === 0) {
    return [...header, "", "No encontré operaciones que encajen con esa consulta."].join("\n");
  }

  const sections = [...header, ""];
  let shownResults = 0;
  for (const [index, result] of summary.results.entries()) {
    const nextSection = formatResult(result, index);
    const candidate = [...sections, nextSection].join("\n");
    if (candidate.length > 1_900) {
      break;
    }
    sections.push(nextSection, "");
    shownResults += 1;
  }

  if (shownResults < summary.results.length) {
    sections.push(`_${summary.results.length - shownResults} resultado(s) omitido(s) por límite de longitud de Discord._`);
  }

  return sections.join("\n").trim();
}
