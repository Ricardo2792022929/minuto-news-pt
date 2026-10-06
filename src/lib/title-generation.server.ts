// Geração de títulos e resumos com Google Gemini (chave própria GEMINI_API_KEY).
const REQUESTED_MODEL = "gemini-1.5-flash";
// gemini-1.5-flash foi retirado pela Google (404); usa o Flash atual nesse caso.
const FALLBACK_MODEL = "gemini-flash-latest";

const SYSTEM = `És um editor de notícias em português de Portugal. Para cada notícia recebida:
- "titulo": título novo, curto e cativante, 6 a 10 palavras, começa pelo SUJEITO ou AÇÃO, sem prefixos ("Urgente:", "Crise em...") nem dois-pontos. Reescreve do zero, só com factos recebidos.
- "resumo": 1 a 2 frases curtas, objetivas e apelativas (máx. 30 palavras), só com factos recebidos.
- "termo_pesquisa_imagem": 2 a 4 palavras em INGLÊS, visuais e concretas, focadas no sujeito principal (pessoa: NOME + profissão, sem acentos).
- "entidade_wikipedia": título exato da página da Wikipedia em inglês se for pessoa/clube/entidade conhecida; caso contrário "".
Devolve um item por cada id recebido, mantendo o id exato.`;

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
  properties: {
    titulos: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          titulo: { type: "STRING" },
          resumo: { type: "STRING" },
          termo_pesquisa_imagem: { type: "STRING" },
          entidade_wikipedia: { type: "STRING" },
        },
        required: ["id", "titulo", "resumo", "termo_pesquisa_imagem", "entidade_wikipedia"],
      },
    },
  },
  required: ["titulos"],
};

async function callGemini(model: string, apiKey: string, prompt: string) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(60_000),
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

  const prompt = JSON.stringify(
    items.map((i) => ({ id: i.id, titulo_original: i.title, descricao: i.excerpt.slice(0, 400) })),
  );
  let res = await callGemini(REQUESTED_MODEL, apiKey, prompt);
  if (res.status === 404) res = await callGemini(FALLBACK_MODEL, apiKey, prompt);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GatewayError(text.slice(0, 300) || `HTTP ${res.status}`, res.status);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const parsed = JSON.parse(raw) as {
    titulos?: { id: string; titulo: string; resumo: string; termo_pesquisa_imagem: string; entidade_wikipedia: string }[];
  };
  const map = new Map<string, GeneratedTitle>();
  for (const t of parsed.titulos ?? []) {
    const clean = cleanTitle(t.titulo ?? "");
    if (!clean) continue;
    map.set(t.id, {
      titulo: clean,
      resumo: (t.resumo ?? "").trim().slice(0, 300),
      termo: (t.termo_pesquisa_imagem ?? "").trim().slice(0, 60),
      entidade: (t.entidade_wikipedia ?? "").trim().slice(0, 80),
    });
  }
  return map;
}
