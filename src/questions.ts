import { readFile } from "node:fs/promises";
import { env } from "./config.js";
import type { GmRecord, QuestionTemplate } from "./types.js";

const fallbackQuestions: QuestionTemplate[] = [
  {
    category: "dirección deportiva",
    text: "¿Cuál es la prioridad más clara de la dirección deportiva de {team} ahora mismo?"
  },
  {
    category: "rotación",
    text: "¿Qué jugador de {team} se ha ganado un rol más importante?"
  },
  {
    category: "mercado de traspasos",
    text: "¿Qué nivel de actividad debería esperar la liga de {team} en conversaciones de traspaso?"
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
