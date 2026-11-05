// Títulos em lote: um pedido com várias notícias, em vez de um pedido por notícia.
// As regras são enviadas uma só vez por pedido, o que poupa pedidos e tokens nos planos gratuitos.
// Cada título que volta passa depois pelas mesmas regras de qualidade, um a um, na ronda.
import { TITLE_SYSTEM, askGeminiRaw } from "./title-generation.server";
import { askGroqRaw } from "./title-generation.groq.server";
import { askCloudflareRaw } from "./title-generation.cloudflare.server";
import { askOpenRouterRaw } from "./title-generation.openrouter.server";
import { askNvidiaRaw } from "./title-generation.nvidia.server";

export type BatchItem = { title: string; articleText: string | null };
export type BatchAnswer = { titulo: unknown; resumo: unknown };
export type BatchApi = "groq" | "gemini" | "cloudflare" | "openrouter" | "nvidia";

/** Texto da notícia por item: chega para o contexto sem encher o pedido. */
const CONTEXT_CHARS = 600;

const FORMAT_LINE = /Responde (?:APENAS|só) com JSON[^\n]*\n?/i;
const BATCH_FORMAT = `Vais receber várias notícias numeradas. Para cada uma, escreve um título e um resumo seguindo as regras acima, cada notícia independente das outras.
Responde só com JSON {"itens":[{"id":1,"titulo":"...","resumo":"..."}]}, com um item por notícia e o mesmo id.
`;

// Os exemplos das regras vêm no formato de uma notícia só; em lote passam a texto simples.
export const BATCH_SYSTEM = (FORMAT_LINE.test(TITLE_SYSTEM)
  ? TITLE_SYSTEM.replace(FORMAT_LINE, BATCH_FORMAT)
  : `${TITLE_SYSTEM}\n\n${BATCH_FORMAT}`
).replace(/\{"titulo":\s*"([^"]+)"\}/g, '"$1"');

const GEMINI_BATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    itens: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "INTEGER" }, titulo: { type: "STRING" }, resumo: { type: "STRING" } },
        required: ["id", "titulo", "resumo"],
      },
    },
  },
  required: ["itens"],
};

export function batchPrompt(items: BatchItem[]): string {
  const head = "Para cada notícia, conta o facto como se o dissesses a alguém, numa frase nova, em português de Portugal, de 6 a 10 palavras. Ordem normal, sem inverter a frase e sem fazer uma pergunta. Não copies nem cortes o título original. Não acrescentes números nem detalhes que o original não tem. Não uses abala, chocante ou incrível. Biza = 2 golos, hat-trick = 3, póquer = 4. Usa o texto da notícia só para perceber o contexto.";
  const body = items
    .map((item, index) => {
      const context = item.articleText ? `\nTexto da notícia: ${item.articleText.replace(/\s+/g, " ").slice(0, CONTEXT_CHARS)}` : "";
      return `Notícia ${index + 1}\nTítulo original: ${item.title}${context}`;
    })
    .join("\n\n");
  return `${head}\n\n${body}`;
}

/** Lê {"itens":[...]} (ou só a lista) e devolve as respostas por posição (id 1 = primeira notícia). */
export function parseBatch(raw: string | null, count: number): Map<number, BatchAnswer> {
  const out = new Map<number, BatchAnswer>();
  if (!raw) return out;
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  let data: unknown = null;
  const tryParse = (text: string) => { try { return JSON.parse(text) as unknown; } catch { return null; } };
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  const arrayFirst = arrStart >= 0 && (objStart < 0 || arrStart < objStart);
  if (arrayFirst && arrEnd > arrStart) data = tryParse(cleaned.slice(arrStart, arrEnd + 1));
  if (data === null && objStart >= 0 && objEnd > objStart) data = tryParse(cleaned.slice(objStart, objEnd + 1));
  if (data === null && !arrayFirst && arrStart >= 0 && arrEnd > arrStart) data = tryParse(cleaned.slice(arrStart, arrEnd + 1));
  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const list = Array.isArray(data)
    ? data
    : record
      ? (record["itens"] ?? record["items"] ?? record["noticias"] ?? (record["titulo"] !== undefined ? [record] : null))
      : null;
  if (!Array.isArray(list)) return out;
  list.forEach((entry, position) => {
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    const idRaw = Number(record["id"]);
    const id = Number.isInteger(idRaw) && idRaw >= 1 && idRaw <= count ? idRaw : position + 1;
    if (id > count || out.has(id)) return;
    out.set(id, { titulo: record["titulo"], resumo: record["resumo"] });
  });
  return out;
}

type Provider = { api: BatchApi; size: number; ask: (items: BatchItem[], timeLeftMs?: number) => Promise<string | null> };

/** Tokens de saída: ~70 por notícia, mais folga para o raciocínio dos modelos que pensam antes. */
const outTokens = (count: number, extra: number) => Math.min(4000, 120 + count * 90 + extra);

/** Ordem: as rápidas e boas primeiro, a Nvidia (lenta) por último. Modelos pequenos levam lotes mais curtos. */
export const BATCH_PROVIDERS: Provider[] = [
  { api: "groq", size: 8, ask: (items) => askGroqRaw(BATCH_SYSTEM, batchPrompt(items), outTokens(items.length, 800)) },
  { api: "gemini", size: 8, ask: (items) => askGeminiRaw(BATCH_SYSTEM, batchPrompt(items), GEMINI_BATCH_SCHEMA) },
  { api: "cloudflare", size: 4, ask: (items) => askCloudflareRaw(BATCH_SYSTEM, batchPrompt(items), outTokens(items.length, 0)) },
  { api: "openrouter", size: 8, ask: (items) => askOpenRouterRaw(BATCH_SYSTEM, batchPrompt(items), outTokens(items.length, 200)) },
  { api: "nvidia", size: 4, ask: (items, timeLeftMs) => askNvidiaRaw(BATCH_SYSTEM, batchPrompt(items), outTokens(items.length, 200), timeLeftMs) },
];

/** Um pedido a uma IA com várias notícias. `responded` diz se a IA chegou a responder (para a memória de falhas). */
export async function askBatch(provider: Provider, items: BatchItem[], timeLeftMs?: number): Promise<{ responded: boolean; answers: Map<number, BatchAnswer> }> {
  const raw = await provider.ask(items, timeLeftMs).catch(() => null);
  return { responded: Boolean(raw), answers: parseBatch(raw, items.length) };
}
