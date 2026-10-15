// Geração de título + resumo com Google Gemini (chave própria GEMINI_API_KEY, só servidor).
// Confirmado via API para esta chave; thinkingLevel "minimal" é o mínimo aceite (thinkingBudget 0 dá 400).
const MODEL = "gemini-flash-lite-latest";
const TIMEOUT_MS = 6_000;
let geminiCooldownUntil = 0;

const SYSTEM = `És o editor do Flash Notícias. O teu trabalho é resumir a notícia num título novo que prenda o scroll.

REGRAS OBRIGATÓRIAS PARA O TÍTULO:
- Escreve estritamente em Português de Portugal (PT-PT). Nunca inglês nem português do Brasil.
- Diz golo, equipa, facto, autocarro e comboio. Não digas gol, time, você, equipe, ônibus ou trem.
- NO MÁXIMO 12 palavras. O ideal são 6 a 11.
- É um RESUMO do facto, não o título original cortado.
- Escreve outra frase. Não copies a ordem nem as primeiras palavras do original.
- Começa pela pessoa, clube ou pelo choque do que aconteceu.
- Tom direto, tenso e provocador. O leitor tem de querer saber o resto.
- Não inventes mortos, números, nomes, acusações ou desfechos que não estejam no título.
- Sem prefixos (Urgente, Crise, Atenção, Última hora, Breaking) e sem dois-pontos.
- Frase completa e fechada. Nunca termines em de, do, da, em, no, na, com, para, e, que, por.
- O resumo tem 1 frase curta, só com o facto.
- Responde APENAS com JSON válido com as chaves 'titulo' e 'resumo'.

Exemplo incorreto:
{"titulo": "Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas", "resumo": "..."}

Exemplo correto:
{"titulo": "Sánchez marca eleições e abala Espanha", "resumo": "O primeiro-ministro espanhol dissolveu o parlamento e marcou eleições antecipadas."}`;

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
  let capped = words.length > 12 ? words.slice(0, 12) : [...words];
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

const BRAZIL = /\b(voce|voces|onibus|goleiro|zagueiro|torcida|gramado|celular|usuario|caminhao|xicara|equipe|gol|time|trem|fato|registro|arquibancada)\b/;
const ENGLISH = new Set(["the", "and", "of", "for", "with", "from", "after", "before", "over", "under", "into", "amid", "beat", "beats", "win", "wins", "won", "says", "said", "will", "has", "have", "his", "her", "their", "its", "scores", "scored", "dies", "died", "killed", "against", "during", "while", "about", "according", "this", "that", "was", "were", "are", "is", "to", "by", "at", "in", "on", "an", "not", "but", "or"]);
const PORTUGUESE = new Set(["de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas", "que", "com", "para", "por", "um", "uma", "nao", "mais", "apos", "contra", "pelo", "pela", "pelos", "pelas", "num", "numa", "sem", "sobre", "entre", "como", "quando", "onde", "seu", "sua", "aos", "ao", "se", "ja", "ainda", "depois"]);

function plainTokens(value: string): string[] {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

/** Recusa inglês e português do Brasil. Um título sem isto não entra no feed. */
export function isEuropeanPortuguese(title: string): boolean {
  const tokens = plainTokens(title);
  if (!tokens.length || BRAZIL.test(tokens.join(" "))) return false;
  const english = tokens.filter((token) => ENGLISH.has(token)).length;
  const portuguese = tokens.filter((token) => PORTUGUESE.has(token)).length;
  const accent = /[áàâãéêíóôõúç]/i.test(title);
  if (english >= 2) return false;
  if (english >= 1 && portuguese === 0 && !accent) return false;
  return true;
}

function isPrefixCut(candidate: string, original: string): boolean {
  const c = normWords(candidate);
  const o = normWords(original);
  if (c.length < 4 || o.length <= c.length) return false;
  let i = 0;
  while (i < c.length && c[i] === o[i]) i++;
  return i >= Math.min(5, c.length);
}

/** O título publicado é só o original cortado, não um resumo novo. */
export function isPastedTitle(candidate: string, original: string): boolean {
  const c = normWords(candidate);
  const o = normWords(original);
  if (c.length < 4 || !o.length) return false;
  const joinedCandidate = c.join(" ");
  const joinedOriginal = o.join(" ");
  if (joinedCandidate === joinedOriginal || joinedOriginal.includes(joinedCandidate)) return true;
  let prefix = 0;
  const limit = Math.min(c.length, o.length);
  while (prefix < limit && c[prefix] === o[prefix]) prefix++;
  return prefix >= 4 && prefix / c.length >= 0.55;
}

/** No máximo 12 palavras e sempre uma frase fechada. */
export function forceMax10Words(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim().replace(/^[\"«“]+|[\"'»”]+$/g, "").replace(/[.!?]+$/, "");
  t = t.replace(PREFIX, "").trim();
  if (t.includes(":") && t.split(":")[0].split(" ").length <= 4) {
    t = t.split(":").slice(1).join(":").trim();
  }
  const all = t.split(/\s+/).map(stripToken).filter(Boolean);
  const usable = (words: string[]) => words.length >= 4 && words.length <= 12 && !isIncomplete(words) && !isFillerStart(words) && !endsAfterComma(words);
  if (usable(all)) return pack(all);
  const clauses = clausesOf(t);
  const preferred = clauses.filter((c) => !isFillerStart(c));
  for (const clause of (preferred.length ? preferred : clauses)) {
    const done = finishClause(clause);
    if (usable(done)) return pack(done);
  }
  const done = finishClause(all);
  if (done.length >= 4 && done.length <= 12 && !isIncomplete(done)) return pack(done);
  const rest = [...all];
  while (rest.length > 3 && isIncomplete(rest)) rest.pop();
  if (rest.length >= 4 && rest.length <= 12 && !isIncomplete(rest)) return pack(rest);
  return t.trim();
}

/** O título só pode aparecer se for um resumo novo, nunca o original nem um corte. */
export function isPublishableTitle(candidate: string | null | undefined, original?: string | null): boolean {
  if (!candidate?.trim()) return false;
  return validTitle(candidate, original || undefined) !== null;
}

export function validTitle(raw: unknown, original?: string): string | null {
  if (typeof raw !== "string") return null;
  const forced = forceMax10Words(raw);
  if (!forced || MARKDOWN.test(forced) || PREFIX.test(forced) || /erro|error/i.test(forced.slice(0, 12))) return null;
  const words = forced.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 12 || isIncomplete(words) || isFillerStart(words) || endsAfterComma(words)) return null;
  if (!isEuropeanPortuguese(forced)) return null;
  if (original && (isPastedTitle(forced, original) || isPrefixCut(forced, original))) return null;
  return forced;
}

/** Título curto quando a API de resumo está no limite. A notícia entra na mesma. */
export function backupTitle(original: string): string {
  const nicer = rewriteFallback(original);
  if (nicer) return nicer;
  let t = original
    .replace(/\s*[-|–—]\s*(CNN\s*Portugal|Público|Publico|Jornal\s*de\s*Negócios|Observador|RTP|Lusa|ECO|Record|A\s*Bola|O\s*Jogo|Expresso|SIC|TSF|SAPO|IOL).*$/i, "")
    .replace(/[\"«»“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(PREFIX, "")
    .trim();
  if (t.includes(":") && t.split(":")[0].split(/\s+/).length <= 4) t = t.split(":").slice(1).join(":").trim();
  const forced = forceMax10Words(t);
  if (forced && forced.split(/\s+/).length >= 4 && forced.split(/\s+/).length <= 12) return forced;
  const words = t.split(/\s+/).map(stripToken).filter(Boolean);
  const capped = words.slice(0, 12);
  while (capped.length > 4 && isIncomplete(capped)) capped.pop();
  const chosen = capped.length >= 4 ? capped : words.slice(0, 8);
  return pack(chosen.length ? chosen : ["Notícia", "em", "atualização", "agora"]);
}

/** Quando a IA falha, tenta uma frase curta diferente do título original. */
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
        generationConfig: { temperature: 0.8, responseMimeType: "application/json", responseSchema, thinkingConfig: { thinkingLevel: "minimal" } },
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
    const prompt = `O título original é só a indicação. Resume esse facto numa frase NOVA, em português de Portugal, até 12 palavras. Não copies nem cortes o original.\nIncorreto: Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas\nCorreto: Sánchez marca eleições e abala Espanha\nTítulo original: ${title}`;
    const res = await callGemini(MODEL, apiKey, prompt);
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        geminiCooldownUntil = Date.now() + (retryAfter > 0 ? Math.min(retryAfter, 7200) * 1000 : 15 * 60_000);
      }
      console.error("Gemini HTTP", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(raw) as { titulo?: unknown; resumo?: unknown };
    const titulo = validTitle(parsed.titulo, title);
    if (!titulo) {
      console.error("Gemini resposta inválida", raw.slice(0, 200));
      return null;
    }
    const resumo = validSummary(parsed.resumo) || titulo;
    console.log(`Gemini OK [${MODEL}] em ${Date.now() - started}ms`);
    return { titulo, resumo };
  } catch (e) {
    console.error(`Gemini falhou após ${Date.now() - started}ms`, e instanceof Error ? e.message : e);
    return null;
  }
}
