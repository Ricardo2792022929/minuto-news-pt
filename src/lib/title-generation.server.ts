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
- NUNCA copies o início do título original. Não comeces por "Do ponto de vista", "Segundo", "De acordo" ou outra introdução. Começa pelo nome de quem age e pelo que fez.
- Não inventes informação.
- Mantém o significado factual da notícia original.
- Não uses clickbait enganador.
- O resumo tem 1 a 2 frases curtas em PT-PT, apenas com factos presentes na notícia.
- Responde APENAS com JSON válido com as chaves 'titulo' e 'resumo'.
- Não uses Markdown, nem \`\`\`json, nem texto fora do JSON.

Exemplo incorreto:
{"titulo": "Do ponto de vista da política externa, Trump", "resumo": "..."}
{"titulo": "Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas", "resumo": "..."}

Exemplo correto:
{"titulo": "Trump muda a política externa dos EUA", "resumo": "O presidente americano anunciou mudanças na política externa."}
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

function stripToken(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function clausesOf(text: string): string[][] {
  const words = text.split(/\s+/).filter(Boolean);
  const parts: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    const bare = stripToken(w);
    if (!bare) continue;
    if (/^(mas|porque|pois)$/i.test(bare) && cur.length >= 4) {
      parts.push(cur);
      cur = [];
      continue;
    }
    cur.push(bare);
    if (/[,:;!?]$/.test(w)) {
      parts.push(cur);
      cur = [];
    }
  }
  if (cur.length) parts.push(cur);
  return parts;
}

function finishClause(words: string[]): string[] {
  let capped = words.length > 10 ? words.slice(0, 10) : [...words];
  while (capped.length > 4 && isIncomplete(capped)) {
    const joined = capped.join(" ");
    const cut = joined.search(/\s+(e|que)\s+\S+$/i);
    if (cut > 12) {
      const next = joined.slice(0, cut).split(/\s+/).filter(Boolean);
      if (next.length >= 4 && !isIncomplete(next)) return next;
    }
    capped.pop();
  }
  return capped;
}

function pack(words: string[]): string {
  const out = words.join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const FILLER = /^(do ponto de vista|segundo|de acordo|na opiniao|em relacao|quanto a|no que diz respeito|para o|para a|sobre o|sobre a|apos o|apos a)\b/;

function normWords(value: string): string[] {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

function isFillerStart(words: string[]): boolean {
  return FILLER.test(normWords(words.join(" ")).join(" "));
}

/** Vírgula e depois só um nome, sem ação. Ex.: "...externa, Trump". */
function endsAfterComma(words: string[]): boolean {
  const joined = words.join(" ");
  const parts = joined.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  return parts[parts.length - 1].split(/\s+/).length < 3;
}

function isPrefixCut(candidate: string, original: string): boolean {
  const c = normWords(candidate);
  const o = normWords(original);
  if (c.length < 4 || o.length <= c.length) return false;
  let i = 0;
  while (i < c.length && c[i] === o[i]) i++;
  return i >= Math.min(5, c.length);
}

/** No máximo 10 palavras e sempre uma frase fechada. */
export function forceMax10Words(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim().replace(/^[\"«“]+|[\"'»”]+$/g, "").replace(/[.!?]+$/, "");
  t = t.replace(PREFIX, "").trim();
  if (t.includes(":") && t.split(":")[0].split(" ").length <= 4) {
    t = t.split(":").slice(1).join(":").trim();
  }
  const all = t.split(/\s+/).map(stripToken).filter(Boolean);
  const usable = (words: string[]) => words.length >= 4 && words.length <= 10 && !isIncomplete(words) && !isFillerStart(words) && !endsAfterComma(words);
  if (usable(all)) return pack(all);
  const clauses = clausesOf(t);
  const preferred = clauses.filter((c) => !isFillerStart(c));
  for (const clause of (preferred.length ? preferred : clauses)) {
    const done = finishClause(clause);
    if (usable(done)) return pack(done);
  }
  const done = finishClause(all);
  if (done.length >= 4 && done.length <= 10 && !isIncomplete(done)) return pack(done);
  const rest = [...all];
  while (rest.length > 3 && isIncomplete(rest)) rest.pop();
  if (rest.length >= 4 && rest.length <= 10 && !isIncomplete(rest)) return pack(rest);
  return t.trim();
}

export function validTitle(raw: unknown, original?: string): string | null {
  if (typeof raw !== "string") return null;
  const forced = forceMax10Words(raw);
  if (!forced || MARKDOWN.test(forced) || PREFIX.test(forced) || /erro|error/i.test(forced.slice(0, 12))) return null;
  const words = forced.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 10 || isIncomplete(words) || isFillerStart(words) || endsAfterComma(words)) return null;
  if (original && isPrefixCut(forced, original)) return null;
  return forced;
}

/** Quando a IA falha, usa a frase depois da introdução em vez de cortar o início. */
export function rewriteFallback(original: string): string | null {
  const source = original.replace(/\s*[-|–—]\s*(CNN\s*Portugal|Público|Publico|Jornal\s*de\s*Negócios|Observador|RTP|Lusa|ECO|Record|A\s*Bola|O\s*Jogo|Expresso|SIC|TSF|SAPO|IOL).*$/i, "").trim();
  const direct = validTitle(source, source);
  if (direct && !isPrefixCut(direct, source)) return direct;
  const after = source.split(/[,;:]/).slice(1).join(" ").trim();
  if (!after) return null;
  return validTitle(after, source);
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
    const prompt = `Reescreve o título. Não copies o início. Começa pelo nome de quem age e pelo que fez, em no máximo 10 palavras, frase completa. Exemplo incorreto: Do ponto de vista da política externa, Trump. Exemplo correto: Trump anuncia mudanças na política externa. Não inventes factos.\nTítulo original: ${title}`;
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
    const titulo = validTitle(parsed.titulo, title);
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
