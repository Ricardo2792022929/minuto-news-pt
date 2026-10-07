// Geração de títulos e resumos com Google Gemini (chave própria GEMINI_API_KEY).
const REQUESTED_MODEL = "gemini-1.5-flash";
// gemini-1.5-flash foi retirado pela Google (404); usa o Flash atual nesse caso.
const FALLBACK_MODEL = "gemini-flash-latest";

const SYSTEM = `És um editor de notícias em Portugal especializado em títulos curtos, diretos e impactantes.
REGRAS OBRIGATÓRIAS:
- Escreve estritamente em Português de Portugal (PT-PT).
- Comprimento: Entre 6 e 10 palavras no máximo.
- Estrutura: Começa SEMPRE com o SUJEITO ou a AÇÃO principal.
- Sem Prefixos: NUNCA uses prefixos (ex: 'Crise em...', 'Urgente:', 'Atenção:').
- Responde APENAS em formato JSON válido com a chave 'titulo'. Sem texto extra.

EXEMPLO INCORRETO:
{"titulo": "Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas"}

EXEMPLO CORRETO:
{"titulo": "Pedro Sánchez anuncia eleições antecipadas em Espanha"}`;

const PREFIX = /^\s*(urgente|aten[cç][aã]o|[uú]ltima hora|breaking|exclusivo|direto|v[ií]deo)\s*[:\-–—]\s*/i;

export function cleanTitle(raw: string): string | null {
  let t = raw.trim().replace(/^["'«“]+|["'»”.]+$/g, "").replace(PREFIX, "");
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

export type GeneratedTitle = { titulo: string; resumo: string; termo: string; entidade: string };

const responseSchema = {
  type: "OBJECT",
  properties: { titulo: { type: "STRING" } },
  required: ["titulo"],
};

async function callGemini(model: string, apiKey: string, prompt: string) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(8_000), // aborta ao fim de 8s e avança para a próxima
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema },
    }),
  });
}

export async function generateTitles(
  items: { id: string; title: string; excerpt: string }[],
): Promise<Map<string, GeneratedTitle>> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new GatewayError("GEMINI_API_KEY em falta", 401);
  const map = new Map<string, GeneratedTitle>();
  for (const [idx, it] of items.entries()) {
    if (idx > 0) await new Promise((r) => setTimeout(r, 2000)); // limite gratuito 15/min
    try {
      const prompt = `Título original: ${it.title}`;
      let res = await callGemini(REQUESTED_MODEL, apiKey, prompt);
      if (res.status === 404) res = await callGemini(FALLBACK_MODEL, apiKey, prompt);
      if (!res.ok) {
        console.error("Gemini HTTP", res.status, (await res.text().catch(() => "")).slice(0, 200));
        if (res.status === 429) break;
        continue;
      }
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const clean = cleanTitle((JSON.parse(raw) as { titulo?: string }).titulo ?? "");
      if (clean) map.set(it.id, { titulo: clean, resumo: "", termo: "", entidade: "" });
    } catch (e) {
      console.error("Gemini falhou", e);
    }
  }
  return map;
}
