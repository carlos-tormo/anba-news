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
        `Fuente ${index + 1}`,
        `Equipo: ${answer.team}`,
        `Pregunta: ${answer.question}`,
        `Respuesta del GM: ${answer.answer}`
      ].join("\n");
    })
    .join("\n\n");

  return `Escribe la noticia de hoy para una liga ficticia de simulación NBA2K usando estas respuestas de los GMs.\n\n${bulletList}`;
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

function fallbackArticle(answers: AnswerForArticle[]): GeneratedArticle {
  const title = "El Pulso de la Liga: Los GMs Marcan el Ritmo";
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
      title: "El Pulso de la Liga",
      body: "No había respuestas de GMs disponibles para la edición de hoy."
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
      `Eres ${env.journalistName}, un periodista bien conectado que cubre una liga online ficticia de NBA2K en simulación completa.`,
      "Escribe siempre en español natural para una audiencia española.",
      "Usa un tono creíble de prensa deportiva, no el tono de un chatbot.",
      "Usa solo las respuestas de los GMs como material factual.",
      "No inventes traspasos, lesiones, clasificaciones ni citas privadas que no estén implicadas por las respuestas.",
      "Mantén el texto entre 250 y 450 palabras.",
      "Empieza con un titular claro en la primera línea y después escribe el cuerpo de la noticia.",
      "Puedes mencionar fuentes de la liga o figuras de los despachos, pero sin abusar de fórmulas de anonimato."
    ].join(" "),
    input: buildInput(answers)
  });

  const text = response.output_text?.trim();
  if (!text) {
    return fallbackArticle(answers);
  }

  return splitGeneratedArticle(text);
}
