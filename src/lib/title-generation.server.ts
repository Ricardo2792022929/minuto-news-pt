// Geração de título + resumo com Google Gemini (chave própria GEMINI_API_KEY, só servidor).
// Confirmado via API para esta chave; thinkingLevel "minimal" é o mínimo aceite (thinkingBudget 0 dá 400).
import { LIGA_CLUBS } from "./clubs";
const MODEL = "gemini-flash-lite-latest";
const TIMEOUT_MS = 6_000;
let geminiCooldownUntil = 0;

const SYSTEM = `És o editor do Flash Notícias. O título é o texto sobre a imagem num feed vertical de telemóvel. Tem de ser lido em menos de 2 segundos e dizer exactamente o que aconteceu.

REGRAS DO TÍTULO:
- Português de Portugal. Diz golo, equipa, facto, autocarro, comboio. Nunca gol, time, você, equipe, ônibus, trem.
- 6 a 10 palavras. Máximo 10. Uma frase completa e fechada, com verbo. Se não couber, escreve só a primeira oração completa. Nunca cortes a meio.
- Afirmativo. Nunca uma pergunta. Nunca dois-pontos. Nunca prefixos (Urgente, Crise, Atenção, Última hora, Breaking).
- Fórmula: sujeito + verbo forte + o facto concreto. Quem fez o quê, no início.
- O sujeito é o mesmo do original. Se o Nacional perde, o título não pode dizer que o Benfica lamenta. Não troques vencedor e vencido, nem quem falou, demitiu, marcou ou morreu.
- Um facto, não o contexto. Sem adjetivos vazios (chocante, incrível, histórico). A tensão vem do detalhe concreto.
- Não inventes mortos, números, nomes, acusações ou desfechos que não estejam no título original.
- Não inventes um confronto entre clubes. Se o original não fala de um jogo, vitória ou derrota entre dois clubes, o título não pode dizer que um "abala", "vence" ou "goleia" o outro.
- Não copies a frase original. Escreve outra, com as mesmas pessoas e o mesmo desfecho.
- Nunca termines em de, do, da, em, no, na, com, para, e, que, por.

RESUMO: 1 frase curta, só com o facto.

Responde APENAS com JSON válido {"titulo","resumo"}.

Incorreto: {"titulo": "Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas"}
Correto: {"titulo": "Sánchez marca eleições e dissolve o parlamento"}`;

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

const VERBS = /\b(marca|marcou|anuncia|anunciou|dissolve|dissolveu|vence|venceu|perde|perdeu|ganha|ganhou|sofre|sofreu|admite|admitiu|acusa|acusou|nega|negou|pede|pediu|exige|exigiu|aprova|aprovou|rejeita|rejeitou|demite|demitiu|nomeia|nomeou|prende|prendeu|mata|matou|morre|morreu|sai|saiu|entra|entrou|volta|voltou|chega|chegou|parte|partiu|abre|abriu|fecha|fechou|sobe|subiu|desce|desceu|cai|caiu|conquista|conquistou|elimina|eliminou|avanca|avança|avancou|avançou|recua|recuou|critica|criticou|elogia|elogiou|alerta|alertou|confirma|confirmou|revela|revelou|denuncia|denunciou|investiga|investigou|condena|condenou|absolve|absolveu|assina|assinou|rompe|rompeu|ameaca|ameaça|ameacou|retira|retirou|levanta|levantou|impoe|impõe|impôs|goleia|goleou|empatou|empata|marcam|anunciam|vencem|perdem|saem|entram|voltam|chegam|morrem|prendem|aprovam|rejeitam|criticam|elogiam|confirmam|revelam|promete|prometeu|empurra|empurrou|participa|participou|instala|instalam|instalou|continua|continuam|continuou|enche|enchem|encheu|considera|considerou|lamenta|lamentou|questiona|questionou|causa|causou|aposta|apostou|afasta|afastou|celebra|celebrou|regressa|regressou|compra|comprou|diz|disse|afirma|afirmou|fica|ficou|deixa|deixou|reune|reúne|reuniu|vive|viveu|edita|editou|provoca|provocou|garante|garantiu|lidera|liderou|aponta|apontou|regista|registou|insta|instou|prioriza|priorizou|elimina|eliminam|mantem|mantém|manteve|abre|abrem|fecha|fecham)\b/i;

function hasAction(words: string[]): boolean {
  return VERBS.test(words.join(" "));
}

function finishClause(words: string[]): string[] {
  const joined = words.join(" ");
  const cut = joined.search(/\s+(e|que|mas|porque)\s+/i);
  if (cut > 0) {
    const head = joined.slice(0, cut).split(/\s+/).filter(Boolean);
    if (head.length >= 4 && head.length <= 10 && !isIncomplete(head) && hasAction(head)) return head;
  }
  let capped = words.length > 10 ? words.slice(0, 10) : [...words];
  while (capped.length > 4 && (isIncomplete(capped) || !hasAction(capped))) capped.pop();
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
  return i >= 8 && i / c.length >= 0.9;
}

/** O título publicado é só o original cortado, não um resumo novo. */
export function isPastedTitle(candidate: string, original: string): boolean {
  const c = normWords(candidate);
  const o = normWords(original);
  if (c.length < 4 || !o.length) return false;
  const joinedCandidate = c.join(" ");
  const joinedOriginal = o.join(" ");
  if (joinedCandidate === joinedOriginal) return true;
  let prefix = 0;
  const limit = Math.min(c.length, o.length);
  while (prefix < limit && c[prefix] === o[prefix]) prefix++;
  return prefix >= 8 && prefix / c.length >= 0.9;
}

/** No máximo 10 palavras, com verbo e frase fechada. Sem corte que fique sem sentido. */
export function forceMax10Words(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim().replace(/^[\"«“]+|[\"'»”]+$/g, "").replace(/[.!?]+$/, "");
  t = t.replace(PREFIX, "").trim();
  if (t.includes(":") && t.split(":")[0].split(" ").length <= 4) {
    t = t.split(":").slice(1).join(":").trim();
  }
  const all = t.split(/\s+/).map(stripToken).filter(Boolean);
  const complete = (words: string[]) => words.length >= 4 && words.length <= 10 && !isIncomplete(words) && !isFillerStart(words) && !endsAfterComma(words);
  if (complete(all)) return pack(all);
  const clauses = clausesOf(t);
  const preferred = clauses.filter((c) => !isFillerStart(c));
  for (const clause of (preferred.length ? preferred : clauses)) {
    const done = finishClause(clause);
    if (complete(done) && (done.length === clause.length || hasAction(done))) return pack(done);
  }
  const done = finishClause(all);
  if (complete(done) && (done.length === all.length || hasAction(done))) return pack(done);
  return "";
}

/** O título só pode aparecer se for um resumo novo, nunca o original nem um corte. */
export function isPublishableTitle(candidate: string | null | undefined, original?: string | null): boolean {
  if (!candidate?.trim()) return false;
  return validTitle(candidate, original || undefined) !== null;
}

function foldTitle(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function clubsInTitle(text: string): string[] {
  const folded = foldTitle(text);
  const hits: { id: string; index: number }[] = [];
  for (const club of LIGA_CLUBS) {
    if (club.id === "nacional" && folded.includes("selecao")) continue;
    for (const key of club.keys) {
      const index = key.includes(" ") ? folded.indexOf(key) : folded.search(new RegExp(`(?:^|\\s)${key}(?:\\s|$)`));
      if (index >= 0) hits.push({ id: club.id, index });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    ordered.push(hit.id);
  }
  return ordered;
}

function clubsDoing(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const clause of text.split(/\s+\be\b\s+|\s+\bmas\b\s+|[,;]/i)) {
    if (!pattern.test(foldTitle(clause))) continue;
    const club = clubsInTitle(clause)[0];
    if (club) found.push(club);
  }
  return found;
}

/** Recusa um título que põe a derrota, a vitória ou a frase noutro clube. */
export function swapsStoryActor(candidate: string, original: string): boolean {
  const lostBy = /\b(lamenta|lamentam|lamentou|perde|perdeu|perderam|falha|falhou|sofre|sofreu|encaixa|encaixou|goleado|goleada|derrotado|derrotada)\b/;
  const wonBy = /\b(vence|venceu|vencem|venceram|goleia|goleou|goleiam|ganha|ganhou|triunfa|triunfou|impoe|impõe)\b/;
  const loserOf = (text: string) => {
    const losers = clubsDoing(text, lostBy);
    for (const match of foldTitle(text).matchAll(/derrota d[oa]s?\s+([a-z0-9 ]{3,40})/g)) {
      const club = clubsInTitle(match[1] ?? "")[0];
      if (club) losers.push(club);
    }
    return losers;
  };
  const lostCandidate = loserOf(candidate);
  const lostOriginal = loserOf(original);
  const wonCandidate = clubsDoing(candidate, wonBy);
  const wonOriginal = clubsDoing(original, wonBy);
  if (lostCandidate[0] && lostOriginal[0] && lostCandidate[0] !== lostOriginal[0]) return true;
  if (lostCandidate[0] && wonOriginal.includes(lostCandidate[0]) && !lostOriginal.includes(lostCandidate[0])) return true;
  if (wonCandidate[0] && wonOriginal[0] && wonCandidate[0] !== wonOriginal[0]) return true;
  if (wonCandidate[0] && lostOriginal.includes(wonCandidate[0]) && !wonOriginal.includes(wonCandidate[0])) return true;
  const firstCandidate = clubsInTitle(candidate)[0];
  const originalClubs = clubsInTitle(original);
  if (firstCandidate && originalClubs.length > 0 && !originalClubs.includes(firstCandidate)) return true;
  return false;
}

/** Recusa um título que inventa um confronto entre clubes que o original não tem. */
const MATCH_VERBS = /\b(abala|abalam|vence|venceu|vencem|goleia|goleou|goleiam|derrota|derrotou|humilha|humilhou|esmaga|esmagou|atropela|atropelou)\b/;
function inventsMatch(candidate: string, original: string): boolean {
  const candidateClubs = clubsInTitle(candidate);
  if (candidateClubs.length < 2) return false;
  if (!MATCH_VERBS.test(foldTitle(candidate))) return false;
  const originalClubs = clubsInTitle(original);
  const originalHasMatch = MATCH_VERBS.test(foldTitle(original)) && originalClubs.length >= 2;
  return !originalHasMatch;
}
const FOOTBALL_TERMS: Record<string, string> = { biza: "2", "hat-trick": "3", hatrick: "3", poquer: "4", repoquer: "4" };
function inventsNumber(candidate: string, original: string): boolean {
  const numbers = (text: string) => {
    const found = new Set((text.match(/\d[\d.]*/g) ?? []).map((n) => n.replace(/\./g, "")));
    const lower = text.toLowerCase();
    for (const [term, value] of Object.entries(FOOTBALL_TERMS)) {
      if (lower.includes(term)) found.add(value);
    }
    return found;
  };
  const known = numbers(original);
  const candidateNumbers = (candidate.match(/\d[\d.]*/g) ?? []).map((n) => n.replace(/\./g, ""));
  for (const number of candidateNumbers) if (!known.has(number)) return true;
  return false;
}

export function validTitle(raw: unknown, original?: string): string | null {
  if (typeof raw !== "string") return null;
  const forced = forceMax10Words(raw);
  if (!forced || MARKDOWN.test(forced) || PREFIX.test(forced) || /erro|error/i.test(forced.slice(0, 12))) return null;
  const words = forced.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 10 || isIncomplete(words) || isFillerStart(words) || endsAfterComma(words)) return null;
  if (!isEuropeanPortuguese(forced)) return null;
  if (original && (isPastedTitle(forced, original) || isPrefixCut(forced, original) || swapsStoryActor(forced, original) || inventsNumber(forced, original) || inventsMatch(forced, original))) return null;
  return forced;
}

/** Título curto quando a API de resumo está no limite. A notícia entra na mesma. */
export function backupTitle(original: string): string {
  const nicer = rewriteFallback(original);
  if (nicer && !isPastedTitle(nicer, original) && !isPrefixCut(nicer, original)) return nicer;
  return "";
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
export async function generateOne(title: string, articleText?: string | null): Promise<GeneratedTitle | null> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new GatewayError("GEMINI_API_KEY em falta", 401);
  if (Date.now() < geminiCooldownUntil) return null;
  const started = Date.now();
  try {
    const context = articleText ? `\nTexto da notícia: ${articleText.slice(0, 800)}` : "";
    const prompt = `O título original é só a indicação. Resume esse facto numa frase NOVA, em português de Portugal, de 6 a 10 palavras. Não copies nem cortes o original. Não acrescentes números nem detalhes que o original não tem. Biza = 2 golos, hat-trick = 3, póquer = 4. Nunca inventes um número diferente. Usa o texto da notícia para perceber o contexto, mas o título tem de ser fiel ao facto principal.\nIncorreto: Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas\nCorreto: Sánchez marca eleições e dissolve o parlamento\nTítulo original: ${title}${context}`;
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
