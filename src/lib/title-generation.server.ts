// Geração de título + resumo com Google Gemini (chave própria GEMINI_API_KEY, só servidor).
// Confirmado via API para esta chave; thinkingLevel "minimal" é o mínimo aceite (thinkingBudget 0 dá 400).
const MODEL = "gemini-flash-lite-latest";
const TIMEOUT_MS = 6_000;
let geminiCooldownUntil = 0;

const SYSTEM = `És um editor de notícias em Portugal especializado em títulos curtos, diretos e factuais.

REGRAS OBRIGATÓRIAS PARA O TÍTULO:
- Escreve estritamente em Português de Portugal (PT-PT).
- O título deve ter NO MÁXIMO 10 palavras (idealmente 6 a 10).
- Começa SEMPRE pelo SUJEITO principal (pessoa, entidade ou ação central). Nunca uses estilo "Tema: descrição longa".
- Não uses prefixos como 'Crise:', 'Urgente:', 'Atenção:', 'Última hora:', etc.
- O título tem de ser uma frase COMPLETA e fechada. Nunca cortes a meio. Nunca termines em preposição, conjunção ou verbo incompleto (por, de, em, com, para, e, mas, pode, vai, liga, quem). Se o facto não couber em 10 palavras, reescreve mais curto.
- Não inventes informação.
- Mantém o significado factual da notícia original.
- Não uses clickbait enganador.
- O resumo tem 1 a 2 frases curtas em PT-PT, apenas com factos presentes na notícia.
- Responde APENAS com JSON válido com as chaves 'titulo' e 'resumo'.
- Não uses Markdown, nem \`\`\`json, nem texto fora do JSON.

Exemplo incorreto:
{"titulo": "Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas", "resumo": "..."}

Exemplo correto:
{"titulo": "Pedro Sánchez anuncia eleições antecipadas em Espanha", "resumo": "O primeiro-ministro espanhol dissolveu o parlamento e marcou eleições antecipadas."}`;

export class GatewayError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type GeneratedTitle = { titulo: string; resumo: string };

const responseSchema = {
  type: "OBJECT",
  properties: { titulo: { type: "STRING" }, resumo: { type: "STRING" } },
  required: ["titulo", "resumo"],
};

const PREFIX = /^\s*(urgente|aten[cç][aã]o|crise|[uú]ltima hora|breaking|exclusivo)\s*[:\-–—]/i;
const MARKDOWN = /[*_`#>\[\]]|```/;
/** Palavras que deixam o título incompleto se ficarem no fim. */
const DANGLING = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "e", "ou", "que", "um", "uma", "uns", "umas", "por", "para", "com", "sem", "ao", "aos",
  "se", "num", "numa", "pelo", "pela", "pelos", "pelas", "sobre", "entre", "ate", "desde", "como",
  "mas", "porque", "pois", "quando", "onde", "quem", "qual", "quais",
  "pode", "podem", "possa", "possam", "vai", "vao", "ira", "irao",
  "esta", "estao", "tem", "faz", "fazem", "liga", "ligam", "quer", "querem",
  "deve", "devem", "sera", "serao", "ser", "estar", "ter", "fazer", "tornar", "tornar-se",
]);

function wordKey(word: string): string {
  return word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.,;:!?]+$/g, "");
}

function isIncomplete(words: string[]): boolean {
  if (!words.length) return true;
  const last = wordKey(words[words.length - 1] ?? "");
  if (DANGLING.has(last)) return true;
  const joined = words.join(" ");
  if (/[,:;]\s*$/.test(joined)) return true;
  if (/\b(mas|porque|pois|quando|onde|quem)\s+\w+$/i.test(joined)) return true;
  return false;
}

/** No máximo 10 palavras e sempre uma frase fechada. */
export function forceMax10Words(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim().replace(/^[\"«“]+|[\"'»”]+$/g, "").replace(/[.!?]+$/, "");
  t = t.replace(PREFIX, "").trim();
  if (t.includes(":") && t.split(":")[0].split(" ").length <= 4) {
    t = t.split(":").slice(1).join(":").trim();
  }
  const words = t.split(/\s+/).filter(Boolean);
  let capped = words.length > 10 ? words.slice(0, 10) : [...words];
  while (capped.length > 4 && isIncomplete(capped)) {
    const joined = capped.join(" ");
    const cut = joined.search(/\s+(mas|porque|pois|e|que)\s+\S+$/i);
    if (cut > 12) {
      capped = joined.slice(0, cut).split(/\s+/).filter(Boolean);
      continue;
    }
    capped.pop();
  }
  const out = capped.join(" ").replace(/[,:;]+$/, "").trim();
  if (!out || out.split(/\s+/).length < 4) {
    const fallback = words.slice(0, Math.min(8, words.length));
    while (fallback.length > 4 && isIncomplete(fallback)) fallback.pop();
    const safe = fallback.join(" ").replace(/[,:;]+$/, "").trim();
    if (safe.split(/\s+/).length >= 4) return safe.charAt(0).toUpperCase() + safe.slice(1);
    return raw.trim();
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function validTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const forced = forceMax10Words(raw);
  if (!forced || MARKDOWN.test(forced) || PREFIX.test(forced) || /erro|error/i.test(forced.slice(0, 12))) return null;
  const n = forced.split(" ").length;
  if (n < 4 || n > 10) return null; // permite um pouco mais curto se for direto
  return forced;
}

function validSummary(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length < 20 || s.length > 300 || MARKDOWN.test(s)) return null;
  return s;
}

async function callGemini(model: string, apiKey: string, prompt: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      signal: ctrl.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema, thinkingConfig: { thinkingLevel: "minimal" } },
      }),
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Uma notícia por pedido. Devolve null em qualquer falha (sem fallback). */
export async function generateOne(title: string): Promise<GeneratedTitle | null> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new GatewayError("GEMINI_API_KEY em falta", 401);
  if (Date.now() < geminiCooldownUntil) return null;
  const started = Date.now();
  try {
    const prompt = `Reescreve o título de forma curta, direta e COMPLETA (máximo 10 palavras), começando pelo sujeito ou ação principal. A frase tem de fazer sentido sozinha. Nunca cortes a meio nem acabes em preposição, conjunção ou verbo incompleto (pode, vai, liga, e, mas, quem). Não uses dois pontos para separar tema e descrição. Prioriza factos confirmados no título original.\nTítulo original: ${title}`;
    const res = await callGemini(MODEL, apiKey, prompt);
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        geminiCooldownUntil = Date.now() + (retryAfter > 0 ? Math.min(retryAfter, 180) * 1000 : 30_000);
      }
      console.error("Gemini HTTP", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(raw) as { titulo?: unknown; resumo?: unknown };
    const titulo = validTitle(parsed.titulo);
    const resumo = validSummary(parsed.resumo);
    if (!titulo || !resumo) {
      console.error("Gemini resposta inválida", raw.slice(0, 200));
      return null;
    }
    console.log(`Gemini OK [${MODEL}] em ${Date.now() - started}ms`);
    return { titulo, resumo };
  } catch (e) {
    console.error(`Gemini falhou após ${Date.now() - started}ms`, e instanceof Error ? e.message : e);
    return null;
  }
}
