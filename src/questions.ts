import { readFile } from "node:fs/promises";
import { env } from "./config.js";
import type { GmRecord, QuestionTemplate } from "./types.js";

const fallbackQuestions: QuestionTemplate[] = [
  {
    category: "front-office direction",
    text: "What is the clearest front-office priority for {team} right now?"
  },
  {
    category: "rotation",
    text: "Which player on {team} has earned a bigger role?"
  },
  {
    category: "trade market",
    text: "How active should the league expect {team} to be in trade talks?"
  }
];

export async function loadQuestionBank(): Promise<QuestionTemplate[]> {
  try {
    const raw = await readFile(env.questionFile, "utf8");
    const parsed = JSON.parse(raw) as QuestionTemplate[];
    return parsed.length > 0 ? parsed : fallbackQuestions;
  } catch {
    return fallbackQuestions;
  }
}

export function renderQuestion(template: QuestionTemplate, gm: GmRecord): string {
  return template.text.replaceAll("{team}", gm.team).replaceAll("{gm}", gm.displayName);
}

export function pickRandomQuestion(questions: QuestionTemplate[]): QuestionTemplate {
  return questions[Math.floor(Math.random() * questions.length)] ?? fallbackQuestions[0];
}
