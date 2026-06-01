import OpenAI from "openai";
import { env } from "./config.js";
import type { AnswerForArticle } from "./types.js";

export interface GeneratedArticle {
  title: string;
  body: string;
}

function buildInput(answers: AnswerForArticle[]): string {
  const bulletList = answers
    .map((answer, index) => {
      return [
        `Source ${index + 1}`,
        `Team: ${answer.team}`,
        `Question: ${answer.question}`,
        `GM answer: ${answer.answer}`
      ].join("\n");
    })
    .join("\n\n");

  return `Write today's fictional NBA2K simulation league news article from these GM answers.\n\n${bulletList}`;
}

function splitGeneratedArticle(text: string): GeneratedArticle {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0] ?? "League Notebook";
  const title = firstLine.replace(/^#+\s*/, "").slice(0, 120);
  const body = lines.slice(1).join("\n\n").trim() || text.trim();
  return { title, body };
}

function fallbackArticle(answers: AnswerForArticle[]): GeneratedArticle {
  const title = "League Notebook: GMs Set the Tone";
  const body = answers
    .map((answer) => {
      return `**${answer.team}**\n${answer.answer}`;
    })
    .join("\n\n");

  return { title, body };
}

export async function generateArticle(answers: AnswerForArticle[]): Promise<GeneratedArticle> {
  if (answers.length === 0) {
    return {
      title: "League Notebook",
      body: "No GM answers were available for today's edition."
    };
  }

  if (!env.openaiApiKey) {
    return fallbackArticle(answers);
  }

  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const response = await client.responses.create({
    model: env.openaiModel,
    reasoning: { effort: "low" },
    instructions: [
      `You are ${env.journalistName}, a plugged-in beat reporter covering a fictional NBA2K full-simulation online league.`,
      "Write in a credible sports-news voice, not as a chatbot.",
      "Use only the provided GM answers as factual source material.",
      "Do not invent trades, injuries, standings, or private quotes that are not implied by the answers.",
      "Keep it between 250 and 450 words.",
      "Start with a sharp headline on the first line, then the article body.",
      "Mention that answers came from league sources or front-office figures without overusing anonymous-sourcing cliches."
    ].join(" "),
    input: buildInput(answers)
  });

  const text = response.output_text?.trim();
  if (!text) {
    return fallbackArticle(answers);
  }

  return splitGeneratedArticle(text);
}
