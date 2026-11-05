export type LigaClub = { id: string; name: string; keys: string[]; color?: string };

/** Primeira Liga 2026/27. */
export const LIGA_CLUBS: LigaClub[] = [
  { id: "porto", name: "FC Porto", keys: ["fc porto", "porto", "dragao", "dragoes"], color: "#0038A8" },
  { id: "benfica", name: "Benfica", keys: ["benfica"], color: "#E30613" },
  { id: "sporting", name: "Sporting", keys: ["sporting"], color: "#008057" },
  { id: "santa-clara", name: "Santa Clara", keys: ["santa clara"] },
  { id: "viseu", name: "Académico de Viseu", keys: ["academico de viseu", "academico"] },
  { id: "arouca", name: "Arouca", keys: ["arouca"] },
  { id: "gil", name: "Gil Vicente", keys: ["gil vicente"] },
  { id: "braga", name: "Braga", keys: ["sc braga", "sporting de braga", "braga"] },
  { id: "estrela", name: "Estrela da Amadora", keys: ["estrela da amadora", "estrela"] },
  { id: "alverca", name: "Alverca", keys: ["alverca"] },
  { id: "maritimo", name: "Marítimo", keys: ["maritimo"] },
  { id: "moreirense", name: "Moreirense", keys: ["moreirense"] },
  { id: "famalicao", name: "Famalicão", keys: ["famalicao"] },
  { id: "vitoria", name: "Vitória de Guimarães", keys: ["vitoria de guimaraes", "vitoria sc", "vitoria"] },
  { id: "nacional", name: "Nacional", keys: ["nacional da madeira", "cd nacional", "nacional"] },
  { id: "rio-ave", name: "Rio Ave", keys: ["rio ave"] },
  { id: "casa-pia", name: "Casa Pia", keys: ["casa pia"] },
  { id: "estoril", name: "Estoril Praia", keys: ["estoril"] },
];

const SMALL_WORDS = new Set(["de", "da", "do", "dos", "das"]);

/** Monograma de duas letras para o clube (ex.: "Gil Vicente" -> "GV", "Benfica" -> "BE"). */
export function clubInitials(name: string): string {
  const words = name
    .replace(/^FC\s+/i, "")
    .split(/\s+/)
    .filter((word) => word && !SMALL_WORDS.has(word.toLowerCase()));
  if (words.length === 0) return "";
  const first = words[0] ?? "";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  const second = words[1] ?? "";
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

function plain(title: string): string {
  return title.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function hasKey(text: string, key: string): boolean {
  if (key.includes(" ")) return text.includes(key);
  return new RegExp(`(?:^|\\s)${key}(?:\\s|$)`).test(text);
}

export function articleMatchesClub(title: string, category: string, clubId: string): boolean {
  if (category !== "Desporto") return false;
  const club = LIGA_CLUBS.find((item) => item.id === clubId);
  if (!club) return false;
  const text = plain(title);
  if (club.id === "nacional" && text.includes("selecao")) return false;
  return club.keys.some((key) => hasKey(text, key));
}
