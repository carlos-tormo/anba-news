import "dotenv/config";
import path from "node:path";

const rootDir = process.cwd();

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const hasDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
  const hasSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");
  if (trimmed.length >= 2 && (hasDoubleQuotes || hasSingleQuotes)) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

export const env = {
  discordToken: normalizeEnvValue(process.env.DISCORD_TOKEN) ?? "",
  discordGuildId: normalizeEnvValue(process.env.DISCORD_GUILD_ID),
  openaiApiKey: normalizeEnvValue(process.env.OPENAI_API_KEY),
  openaiModel: normalizeEnvValue(process.env.OPENAI_MODEL) ?? "gpt-5.4",
  journalistName: normalizeEnvValue(process.env.JOURNALIST_NAME) ?? "The Association Insider",
  dataFile: path.resolve(rootDir, normalizeEnvValue(process.env.DATA_FILE) ?? "data/league-journalist.json"),
  questionFile: path.resolve(rootDir, normalizeEnvValue(process.env.QUESTION_FILE) ?? "config/questions.json")
};

export function assertRequiredEnv(): void {
  if (!env.discordToken) {
    throw new Error("Missing DISCORD_TOKEN. Add the raw Discord bot token in your environment variables.");
  }

  if (env.discordToken.startsWith("Bot ")) {
    throw new Error("DISCORD_TOKEN should be the raw token only. Remove the leading 'Bot ' prefix.");
  }

  if (/\s/.test(env.discordToken)) {
    throw new Error("DISCORD_TOKEN contains whitespace. Paste the raw token with no spaces, quotes, or line breaks.");
  }
}
