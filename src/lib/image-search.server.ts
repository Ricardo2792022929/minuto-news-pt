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
  if (!terms.length) return [title.trim().slice(0, 80)];
  const results: string[] = [];
  if (terms.length >= 2) results.push(terms.slice(0, 3).join(" "));
  if (terms.length >= 2) results.push(terms.slice(0, 2).join(" "));
  return [...new Set([...results, terms.join(" ")])];
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

/** Pesquisa de imagem sem gastar a API de resumo. Nomes como Papa Leão não viram animais. */
export async function sceneQuery(title: string): Promise<string> {
  const named = namedQuery(title);
  if (named) return named;
  return imageSearchTerms(title)[0] ?? title.slice(0, 60);
}
