import OpenAI from "openai";
import { env } from "./config.js";
import type { AnswerForArticle, RumorForArticle } from "./types.js";

export interface GeneratedArticle {
  title: string;
  body: string;
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
  const body = lines.slice(1).join("\n\n").trim() || text.trim();
  return { title, body };
}

function fallbackArticle(answers: AnswerForArticle[], rumors: RumorForArticle[]): GeneratedArticle {
  const title = "El Pulso de la Liga: Los GMs Marcan el Ritmo";
  const answerBody = answers
    .map((answer) => {
      return `**${answer.team}**\n${answer.answer}`;
    })
    .join("\n\n");

  const rumorBody = rumors
    .map((rumor) => {
      return `**Rumor${rumor.team ? ` - ${rumor.team}` : ""}**\n${rumor.text}`;
    })
    .join("\n\n");

  return { title, body: [answerBody, rumorBody].filter(Boolean).join("\n\n") };
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
      "Mantén el texto entre 250 y 450 palabras.",
      "Empieza con un titular claro en la primera línea y después escribe el cuerpo de la noticia.",
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
