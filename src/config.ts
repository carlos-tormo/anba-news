import "dotenv/config";
import path from "node:path";

const rootDir = process.cwd();

export const env = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.4",
  journalistName: process.env.JOURNALIST_NAME ?? "The Association Insider",
  dataFile: path.resolve(rootDir, process.env.DATA_FILE ?? "data/league-journalist.json"),
  questionFile: path.resolve(rootDir, process.env.QUESTION_FILE ?? "config/questions.json")
};

export function assertRequiredEnv(): void {
  if (!env.discordToken) {
    throw new Error("Missing DISCORD_TOKEN. Copy .env.example to .env and add your Discord bot token.");
  }
}
