/** Extrai as palavras mais importantes de um título para pesquisa de imagens. */
const STOP = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "um", "uma", "uns", "umas", "e", "ou", "mas", "para", "por", "com", "sem", "sobre",
  "que", "se", "the", "of", "and", "to", "in", "on", "for", "with", "from", "by",
  "anuncia", "diz", "afirma", "revela", "hoje", "ontem", "amanha", "portugal", "portugues",
  "portuguesa", "noticias", "noticia", "ultimas", "ultima", "hora", "breaking"
]);

const ANIMAL = new Set(["leao", "leão", "lion", "tigre", "tiger", "aguia", "eagle", "lobo", "wolf", "urso", "bear", "touro", "bull"]);

const NAMED: [RegExp, string][] = [
  [/papa\s+le[aã]o|le[aã]o\s+xiv/i, "Pope Leo XIV"],
  [/papa\s+francisco/i, "Pope Francis"],
];

export function extractImageTerms(title: string): string[] {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(" ").filter((w) => w.length > 3 && !STOP.has(w) && !ANIMAL.has(w));
  return words.slice(0, 4);
}

/** Gera termos de pesquisa progressivos (do mais específico ao mais genérico). */
export function imageSearchTerms(title: string): string[] {
  const named = namedQuery(title);
  if (named) return [named];
  const terms = extractImageTerms(title);
  if (!terms.length) return [title.slice(0, 60)];
  const results: string[] = [];
  if (terms.length >= 2) results.push(terms.slice(0, 3).join(" "));
  if (terms.length >= 2) results.push(terms.slice(0, 2).join(" "));
  return [...new Set(results)];
}

export function namedQuery(title: string): string | null {
  for (const [pattern, query] of NAMED) if (pattern.test(title)) return query;
  return null;
}

export function riskyImageTitle(title: string): boolean {
  if (namedQuery(title)) return true;
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return [...ANIMAL].some((word) => normalized.includes(word));
}

function saneQuery(query: string, title: string): string | null {
  const named = namedQuery(title);
  if (named) return named;
  const clean = query.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 80) return null;
  const words = clean.toLowerCase().split(" ").filter(Boolean);
  if (words.length === 1 && ANIMAL.has(words[0].normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) return null;
  if (words.some((word) => word === "lion" || word === "leao")) return null;
  return clean;
}

/** O Gemini descreve quem fotografar. O Pexels sozinho traduz «Leão» para um leão. */
export async function sceneQuery(title: string): Promise<string> {
  const named = namedQuery(title);
  if (named) return named;
  const apiKey = process.env["GEMINI_API_KEY"];
  if (apiKey) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4_000);
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{
              text: `Transforma este título de notícia numa pesquisa de imagem em inglês, com 2 a 4 palavras, descrevendo a PESSOA ou o SÍTIO a fotografar.
Nomes próprios não se traduzem para animais ou objetos. "Papa Leão XIV" é o Papa, não um leão. A resposta certa é "Pope Leo XIV".
Não inventes cenas. Responde só JSON {"query":"..."}.
Título: ${title}`,
            }],
          }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const raw = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
        const parsed = JSON.parse(raw) as { query?: unknown };
        if (typeof parsed.query === "string") {
          const query = saneQuery(parsed.query, title);
          if (query) return query;
        }
      }
    } catch {
      /* usa as palavras do título, sem animais */
    } finally {
      clearTimeout(timer);
    }
  }
  return imageSearchTerms(title)[0] ?? title.slice(0, 60);
}
