/** Extrai as palavras mais importantes de um título para pesquisa de imagens. */
const STOP = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "um", "uma", "uns", "umas", "e", "ou", "mas", "para", "por", "com", "sem", "sobre",
  "que", "se", "the", "of", "and", "to", "in", "on", "for", "with", "from", "by",
  "anuncia", "diz", "afirma", "revela", "hoje", "ontem", "amanha", "portugal", "portugues",
  "portuguesa", "noticias", "noticia", "ultimas", "ultima", "hora", "breaking"
]);

export function extractImageTerms(title: string): string[] {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(" ").filter((w) => w.length > 3 && !STOP.has(w));
  // Prioriza as primeiras palavras (sujeito) e limita a 4 termos
  return words.slice(0, 4);
}

/** Gera termos de pesquisa progressivos (do mais específico ao mais genérico). */
export function imageSearchTerms(title: string): string[] {
  const terms = extractImageTerms(title);
  if (!terms.length) return [title.slice(0, 60)];
  const results: string[] = [];
  // Termo completo (mais específico)
  if (terms.length >= 2) results.push(terms.slice(0, 3).join(" "));
  // Primeiras 2 palavras
  if (terms.length >= 2) results.push(terms.slice(0, 2).join(" "));
  // Primeira palavra (sujeito)
  results.push(terms[0]);
  return [...new Set(results)];
}
