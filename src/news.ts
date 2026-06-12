import OpenAI from "openai";
import { env } from "./config.js";
import type { AnswerForArticle, RumorForArticle } from "./types.js";

export interface GeneratedArticle {
  title: string;
  body: string;
}

const MAX_FALLBACK_ITEM_CHARS = 260;
const MAX_GENERATED_BULLETS = 3;
const MAX_GENERATED_BULLET_CHARS = 700;

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function normalizeBulletBody(lines: string[]): string {
  const bullets: string[] = [];

  for (const line of lines) {
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, "- "));
      continue;
    }

    if (bullets.length > 0 && !/^\d+[.)]\s+/.test(line)) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line}`;
      continue;
    }

    bullets.push(`- ${line.replace(/^\d+[.)]\s+/, "")}`);
  }

  return bullets
    .slice(0, MAX_GENERATED_BULLETS)
    .map((bullet) => compactText(bullet, MAX_GENERATED_BULLET_CHARS))
    .join("\n");
}

function buildInput(answers: AnswerForArticle[], rumors: RumorForArticle[]): string {
  const answerList = answers
    .map((answer, index) => {
      return [
        `Respuesta GM ${index + 1}`,
        `Equipo: ${answer.team}`,
        `Pregunta: ${answer.question}`,
        `Respuesta del GM: ${answer.answer}`
      ].join("\n");
    })
    .join("\n\n");

  const rumorList = rumors
    .map((rumor, index) => {
      return [
        `Rumor ${index + 1}`,
        `Equipo relacionado: ${rumor.team ?? "sin equipo concreto"}`,
        `Texto filtrado a la redacción: ${rumor.text}`
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Escribe la noticia de hoy para una liga ficticia de simulación NBA2K usando estas fuentes.",
    "",
    "Respuestas confirmadas de GMs:",
    answerList || "No hay respuestas de GMs.",
    "",
    "Rumores no verificados recibidos por la redacción:",
    rumorList || "No hay rumores."
  ].join("\n");
}

function splitGeneratedArticle(text: string): GeneratedArticle {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0] ?? "El Pulso de la Liga";
  const title = firstLine.replace(/^#+\s*/, "").slice(0, 120);
  const body = normalizeBulletBody(lines.slice(1)).trim() || text.trim();
  return { title, body };
}

function fallbackArticle(answers: AnswerForArticle[], rumors: RumorForArticle[]): GeneratedArticle {
  const title = "El Pulso de la Liga: Los GMs Marcan el Ritmo";
  const answerBullets = answers.map((answer) => {
    return `- **${answer.team}:** ${compactText(answer.answer, MAX_FALLBACK_ITEM_CHARS)}`;
  });
  const rumorBullets = rumors.map((rumor) => {
    return `- **_Rumor_${rumor.team ? ` - ${rumor.team}` : ""}:** ${compactText(rumor.text, MAX_FALLBACK_ITEM_CHARS)}`;
  });

  return { title, body: [...answerBullets, ...rumorBullets].slice(0, 3).join("\n") };
}

export async function generateArticle(answers: AnswerForArticle[], rumors: RumorForArticle[]): Promise<GeneratedArticle> {
  if (answers.length === 0 && rumors.length === 0) {
    return {
      title: "El Pulso de la Liga",
      body: "No había respuestas de GMs ni rumores disponibles para la edición de hoy."
    };
  }

  if (!env.openaiApiKey) {
    return fallbackArticle(answers, rumors);
  }

  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const response = await client.responses.create({
    model: env.openaiModel,
    reasoning: { effort: "low" },
    instructions: [
      `Eres ${env.journalistName}, un periodista bien conectado que cubre una liga online ficticia de NBA2K en simulación completa.`,
      "Escribe siempre en español natural para una audiencia española.",
      "Usa un tono creíble de prensa deportiva, no el tono de un chatbot.",
      "Usa solo las respuestas de los GMs como material factual confirmado.",
      "Los rumores son material no verificado: puedes mencionarlos como rumores, filtraciones o ruido de mercado, pero nunca como hechos confirmados.",
      "No inventes traspasos, lesiones, clasificaciones ni citas privadas que no estén implicadas por las respuestas.",
      "Agrupa las fuentes por grandes temas comunes; no escribas un párrafo separado por cada GM si varios apuntan al mismo asunto.",
      "Empieza con un titular claro en la primera línea y después escribe el cuerpo de la noticia.",
      "El cuerpo debe tener como máximo 3 bullets de Markdown; si hay suficiente material, usa 3.",
      "No escribas introducción, cierre ni párrafos fuera de los bullets.",
      "Cada bullet debe empezar con '- **Tema breve:**' y resumir el asunto en una o dos frases.",
      "Usa formato de Discord con negritas para equipos o conceptos clave y cursiva para rumores o información no verificada.",
      "Mantén el cuerpo completo entre 120 y 220 palabras.",
      "Puedes mencionar fuentes de la liga o figuras de los despachos, pero sin abusar de fórmulas de anonimato."
    ].join(" "),
    input: buildInput(answers, rumors)
  });

  const text = response.output_text?.trim();
  if (!text) {
    return fallbackArticle(answers, rumors);
  }

  return splitGeneratedArticle(text);
}
