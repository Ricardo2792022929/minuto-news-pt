const STOP = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "e", "ou", "que", "um", "uma", "por", "para", "com", "sem", "ao", "aos", "se",
  "num", "numa", "pelo", "pela", "sobre", "entre",
]);

export function normWords(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function significant(words: string[]): string[] {
  return words.filter((word) => word.length > 2 && !STOP.has(word));
}

/** O título publicado é o original, um corte ou quase as mesmas palavras. Não é um resumo. */
export function isPastedTitle(candidate: string, original: string): boolean {
  const c = normWords(candidate);
  const o = normWords(original);
  if (c.length < 4 || o.length === 0) return false;
  const phrase = ` ${c.join(" ")} `;
  const source = ` ${o.join(" ")} `;
  if (phrase.trim() === source.trim() || source.includes(phrase)) return true;

  const sigC = significant(c);
  const sigO = significant(o);
  if (sigC.length >= 4) {
    const known = new Set(sigO);
    const hits = sigC.filter((word) => known.has(word)).length;
    if (hits / sigC.length >= 0.85) return true;
    for (let i = 0; i < o.length; i++) {
      if (o[i] !== sigC[0]) continue;
      let matched = 0;
      let last = i;
      for (let j = i; j < o.length && matched < sigC.length; j++) {
        if (o[j] === sigC[matched]) {
          matched += 1;
          last = j;
        }
      }
      if (matched !== sigC.length) continue;
      const extras = significant(o.slice(i, last + 1)).filter((word) => !sigC.includes(word));
      if (extras.length <= 1) return true;
    }
  }

  let prefix = 0;
  const limit = Math.min(c.length, o.length);
  while (prefix < limit && c[prefix] === o[prefix]) prefix += 1;
  return prefix >= 5 && prefix / c.length >= 0.7;
}
