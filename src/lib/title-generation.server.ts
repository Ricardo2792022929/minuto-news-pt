import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayRunIdFetch } from "./ai-run-id.server.ts";

const MODEL = "openai/gpt-6-astra";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";

const schema = z.object({
  titulos: z.array(z.object({ id: z.string(), titulo: z.string() })),
});

const SYSTEM = `És um editor de títulos de notícias em português de Portugal. Para cada notícia recebida, escreve um título novo, curto e cativante.

REGRAS OBRIGATÓRIAS:
1. Entre 6 e 10 palavras, nunca mais de 10.
2. Começa SEMPRE pelo SUJEITO ou pela AÇÃO principal.
3. NUNCA uses prefixos explicativos ou de contexto (ex.: "Crise em...", "Urgente:", "Atenção:", "Última hora:"), nem dois-pontos a separar contexto.
4. Reescreve o facto do zero. Não te limites a trocar palavras por sinónimos.
5. Usa apenas factos presentes no título e resumo recebidos. Não inventes nem opines.

Exemplo incorreto: "Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas"
Exemplo correto: "Pedro Sánchez anuncia eleições antecipadas em Espanha"

Devolve um título por cada id recebido, mantendo o id exato.`;

const PREFIX = /^\s*(urgente|aten[cç][aã]o|[uú]ltima hora|breaking|exclusivo|direto|v[ií]deo)\s*[:\-–—]\s*/i;

export function cleanTitle(raw: string): string | null {
  let t = raw.trim().replace(/^["'«“]+|["'»”.]+$/g, "").replace(PREFIX, "");
  // remove "Contexto: " no início
  const colon = t.indexOf(":");
  if (colon > 0 && colon < 40) t = t.slice(colon + 1).trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 4) return null;
  t = words.slice(0, 10).join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export class GatewayError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function generateTitles(
  items: { id: string; title: string; excerpt: string }[],
): Promise<Map<string, string>> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new GatewayError("LOVABLE_API_KEY em falta", 401);

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const res = await runIdFetch.fetch(input, init);
      if (res.status === 402 || res.status === 403 || res.status === 429) {
        const text = await res.clone().text().catch(() => "");
        throw new GatewayError(text.slice(0, 300) || `HTTP ${res.status}`, res.status);
      }
      return res;
    },
  });

  const result = streamText({
    model: provider.responses(MODEL),
    system: SYSTEM,
    prompt: JSON.stringify(
      items.map((i) => ({ id: i.id, titulo_original: i.title, resumo: i.excerpt.slice(0, 300) })),
    ),
    output: Output.object({ schema }),
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  try {
    const out = await result.output;
    const map = new Map<string, string>();
    for (const t of out.titulos) {
      const clean = cleanTitle(t.titulo);
      if (clean) map.set(t.id, clean);
    }
    return map;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) return new Map();
    throw error;
  }
}
