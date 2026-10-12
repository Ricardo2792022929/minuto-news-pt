export type LigaClub = { id: string; name: string; keys: string[] };

/** Primeira Liga 2026/27. */
export const LIGA_CLUBS: LigaClub[] = [
  { id: "porto", name: "FC Porto", keys: ["fc porto", "porto", "dragao", "dragoes"] },
  { id: "benfica", name: "Benfica", keys: ["benfica"] },
  { id: "sporting", name: "Sporting", keys: ["sporting"] },
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
