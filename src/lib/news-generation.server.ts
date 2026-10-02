import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayRunIdFetch } from "./ai-run-id.server.ts";

const MODEL = "openai/gpt-6-astra";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";

const publicationSchema = z.object({
  titulo_inedito: z.string(),
  bullets: z.array(z.string()),
  url_imagem_original: z.string().nullable(),
  keywords_imagem_reserva: z.string(),
});

export interface GeneratedPublication {
  titulo_inedito: string;
  bullets: string[];
  url_imagem_original: string | null;
  keywords_imagem_reserva: string;
}

const SYSTEM = `És um editor de notícias em tempo real. Recebes conteúdo de uma fonte externa e crias uma publicação jornalística nova em português de Portugal.

REGRAS EDITORIAIS OBRIGATÓRIAS:
1. Extrai apenas factos verificáveis presentes na entrada: o quê, quem, onde e quando. Não inventes, não opines e não acrescentes conhecimento externo.
2. Não reutilizes a estrutura, o tom, a ordem das palavras, frases, expressões ou excertos literais da fonte. Uma simples troca por sinónimos é proibida.
3. Cria um título factual e neutro, totalmente novo, com no máximo 12 palavras e construção sintática diferente do original.
4. Cria exatamente 3 bullets, todos com redação própria:
   - primeiro: acontecimento principal;
   - segundo: contexto ou dados envolvidos;
   - terceiro: relevância ou desfecho provisório.
5. Os bullets devem ser concisos e funcionar como introdução. Não reproduzas o artigo completo.
6. Preserva exatamente o URL da imagem recebido. Se não existir, usa null.
7. Gera exatamente duas palavras-chave genéricas em inglês para uma imagem de reserva.
8. Não comentes estas regras, a qualidade nem a quantidade do texto recebido.`;

function clampWords(value: string, max: number): string {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, max).join(" ");
}

function normalizePublication(
  value: GeneratedPublication,
  imageUrl: string | null,
): GeneratedPublication | null {
  const title = clampWords(value.titulo_inedito, 12);
  const bullets = value.bullets
    .map((bullet) => bullet.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const keywords = value.keywords_imagem_reserva
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");

  if (!title || bullets.length !== 3 || keywords.split(/\s+/).length !== 2) {
    return null;
  }

  return {
    titulo_inedito: title,
    bullets,
    url_imagem_original: imageUrl,
    keywords_imagem_reserva: keywords,
  };
}

export async function generateNewsPublication(input: {
  originalTitle: string;
  text: string;
  source: string;
  imageUrl: string | null;
}): Promise<GeneratedPublication> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("A geração automática não está configurada.");

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: runIdFetch.fetch,
  });

  const result = streamText({
    model: provider.responses(MODEL),
    system: SYSTEM,
    prompt: JSON.stringify({
      titulo_original: input.originalTitle,
      fonte: input.source,
      texto_fonte: input.text.slice(0, 16_000),
      url_imagem_original: input.imageUrl,
    }),
    output: Output.object({ schema: publicationSchema }),
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  try {
    const output = await result.output;
    const normalized = normalizePublication(output, input.imageUrl);
    if (!normalized) throw new Error("A publicação gerada ficou incompleta.");
    return normalized;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new Error("Não foi possível validar a publicação gerada.");
    }
    throw error;
  }
}