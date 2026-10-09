// Geração de título + resumo com Google Gemini (chave própria GEMINI_API_KEY, só servidor).
// Confirmado via API para esta chave; thinkingLevel "minimal" é o mínimo aceite (thinkingBudget 0 dá 400).
const MODEL = "gemini-flash-lite-latest";
const TIMEOUT_MS = 12_000;

const SYSTEM = `És um editor de notícias em Portugal especializado em títulos curtos, diretos e impactantes.

REGRAS OBRIGATÓRIAS:
- Escreve estritamente em Português de Portugal (PT-PT).
- O título deve ter entre 6 e 10 palavras.
- Começa SEMPRE pelo SUJEITO ou pela AÇÃO principal.
- Não uses prefixos como 'Crise:', 'Urgente:', 'Atenção:', etc.
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

export function validTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim().replace(/^["'«“]+|["'»”]+$/g, "").replace(/\.$/, "");
  if (!t || MARKDOWN.test(t) || PREFIX.test(t) || /erro|error/i.test(t.slice(0, 12))) return null;
  const n = t.split(" ").length;
  if (n < 6 || n > 10) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
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
  const started = Date.now();
  try {
    const prompt = `Título original: ${title}`;
    let res = await callGemini(MODEL, apiKey, prompt);
    if (res.status === 503) {
      console.warn("Gemini 503; retry único em 2s");
      await new Promise((r) => setTimeout(r, 2000));
      res = await callGemini(MODEL, apiKey, prompt);
    }
    if (!res.ok) {
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
