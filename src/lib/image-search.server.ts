/** Termos de pesquisa que preservam o título e as entidades específicas da notícia. */
const STOP = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "um", "uma", "uns", "umas", "e", "ou", "mas", "para", "por", "com", "sem", "sobre",
  "que", "se", "the", "of", "and", "to", "in", "on", "for", "with", "from", "by",
  "anuncia", "diz", "afirma", "revela", "hoje", "ontem", "amanha", "portugal", "portugues",
  "portuguesa", "noticias", "noticia", "ultimas", "ultima", "hora", "breaking", "segundo",
  "pode", "podem", "deve", "devem", "apos", "antes", "durante", "novo", "nova", "novos", "novas",
]);
const ANIMAL = new Set(["leao", "leão", "lion", "tigre", "tiger", "aguia", "eagle", "lobo", "wolf", "urso", "bear", "touro", "bull"]);
const NAMED: [RegExp, string][] = [
  [/papa\s+le[aã]o|le[aã]o\s+xiv/i, "Pope Leo XIV"],
  [/papa\s+francisco/i, "Pope Francis"],
];

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export function extractImageTerms(title: string, description = ""): string[] {
  const words = normalize(`${title} ${description.slice(0, 320)}`)
    .split(" ").filter((word) => word.length > 3 && !STOP.has(word) && !ANIMAL.has(word));
  return [...new Set(words)].slice(0, 8);
}

/** O título integral vem primeiro. Os nomes próprios mantêm-se nas pesquisas seguintes. */
export function imageSearchTerms(title: string, description = ""): string[] {
  const original = title.trim().replace(/\s+/g, " ").slice(0, 140);
  const names = [...new Set([
    namedQuery(title),
    ...(title.match(/\b\p{Lu}[\p{L}'’.-]{2,}(?:\s+(?:d[aeo]s?|e|\p{Lu}[\p{L}'’.-]{2,})){0,3}/gu) ?? []),
  ].filter((value): value is string => Boolean(value)))].slice(0, 4);
  const terms = extractImageTerms(title, description);
  const queries = [
    original,
    names.join(" "),
    [names[0], terms.slice(0, 3).join(" ")].filter(Boolean).join(" "),
    terms.slice(0, 4).join(" "),
    terms.slice(0, 2).join(" "),
  ].map((query) => query.replace(/\s+/g, " ").trim()).filter((query) => query.length > 2);
  return [...new Set(queries)].slice(0, 4);
}

export function namedQuery(title: string): string | null {
  for (const [pattern, query] of NAMED) if (pattern.test(title)) return query;
  return null;
}

export function riskyImageTitle(title: string): boolean {
  if (namedQuery(title)) return true;
  const normalized = normalize(title);
  return [...ANIMAL].some((word) => normalized.includes(word));
}

/** Mantém pessoas, equipas, empresas e locais do título, incluindo a sua grafia original. */
export async function sceneQuery(title: string): Promise<string> {
  return namedQuery(title) ?? title.trim().replace(/\s+/g, " ").slice(0, 140);
}
