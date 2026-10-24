import { LIGA_CLUBS } from "./clubs";

function plain(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function hasWord(text: string, key: string): boolean {
  const n = plain(key);
  if (!n) return false;
  if (n.includes(" ")) return text.includes(n);
  return new RegExp(`(?:^|\\s)${n}(?:\\s|$)`).test(text);
}

const SHORT: Record<string, string> = {
  "Académico de Viseu": "Académico",
  "Estrela da Amadora": "Estrela",
  "Vitória de Guimarães": "Vitória",
  "Estoril Praia": "Estoril",
};

const AMBIGUOUS = new Set(["porto", "braga", "vitoria", "estrela", "nacional", "academico"]);
const SPORT = /\b(golo|golos|liga|vence|venceu|derrota|derrotou|jogo|futebol|treinador|estadio)\b/;

const PLACES: [string, string][] = [
  ["lisboa", "Lisboa"],
  ["coimbra", "Coimbra"],
  ["faro", "Faro"],
  ["madeira", "Madeira"],
  ["acores", "Açores"],
  ["algarve", "Algarve"],
  ["setubal", "Setúbal"],
  ["aveiro", "Aveiro"],
  ["guimaraes", "Guimarães"],
  ["funchal", "Funchal"],
  ["leiria", "Leiria"],
  ["evora", "Évora"],
  ["santarem", "Santarém"],
  ["porto", "Porto"],
  ["braga", "Braga"],
  ["viseu", "Viseu"],
  ["ucrania", "Ucrânia"],
  ["gaza", "Gaza"],
  ["israel", "Israel"],
  ["russia", "Rússia"],
  ["estados unidos", "EUA"],
  ["eua", "EUA"],
  ["china", "China"],
  ["espanha", "Espanha"],
  ["franca", "França"],
  ["alemanha", "Alemanha"],
  ["brasil", "Brasil"],
  ["reino unido", "Reino Unido"],
  ["irao", "Irão"],
  ["portugal", "Portugal"],
];

const TOPICS: [string, string][] = [
  ["habitacao", "Habitação"],
  ["arrendamento", "Habitação"],
  ["justica", "Justiça"],
  ["tribunal", "Justiça"],
  ["homicidio", "Justiça"],
  ["detido", "Justiça"],
  ["hospital", "Saúde"],
  ["sns", "Saúde"],
  ["saude", "Saúde"],
  ["eleicoes", "Eleições"],
  ["greve", "Greve"],
  ["incendio", "Clima"],
  ["tempestade", "Clima"],
  ["sismo", "Clima"],
  ["escola", "Escolas"],
  ["professor", "Escolas"],
  ["combustivel", "Energia"],
  ["inflacao", "Economia"],
  ["orcamento", "Economia"],
  ["governo", "Governo"],
  ["ministro", "Governo"],
  ["parlamento", "Governo"],
];

function findClub(text: string, sport: boolean): string | null {
  const keys = LIGA_CLUBS.flatMap((club) => club.keys.map((key) => ({ name: club.name, key: plain(key) })));
  let best: { name: string; index: number; length: number } | null = null;
  for (const item of keys) {
    if (!sport && AMBIGUOUS.has(item.key)) continue;
    if (item.key.includes(" ") ? !text.includes(item.key) : !hasWord(text, item.key)) continue;
    const index = text.indexOf(item.key);
    if (!best || index < best.index || (index === best.index && item.key.length > best.length)) {
      best = { name: SHORT[item.name] ?? item.name, index, length: item.key.length };
    }
  }
  return best?.name ?? null;
}

function findListed(text: string, list: [string, string][]): string | null {
  for (const [key, label] of list) {
    if (hasWord(text, key)) return label;
  }
  return null;
}

/** Etiqueta concreta da notícia: clube, sítio ou tema. A secção fica só nos filtros. */
export function storyLabel(item: { title: string; excerpt?: string; category: string }): string {
  const title = plain(item.title);
  const all = plain(`${item.title} ${item.excerpt ?? ""}`);
  const sport = item.category === "Desporto" || SPORT.test(title);
  const club = findClub(title, sport) || findClub(all, sport);
  if (club) return club;
  if (sport) {
    if (hasWord(all, "champions") || all.includes("liga dos campeoes")) return "Champions";
    if (hasWord(all, "selecao")) return "Seleção";
    if (all.includes("formula 1") || hasWord(all, "f1")) return "Fórmula 1";
    if (hasWord(all, "tenis")) return "Ténis";
    return "Desporto";
  }
  const place = findListed(title, PLACES) || findListed(all, PLACES);
  if (place && place !== "Portugal") return place;
  const topic = findListed(title, TOPICS) || findListed(all, TOPICS);
  if (topic) return topic;
  if (place === "Portugal" || item.category === "Política") return "Portugal";
  if (item.category === "Economia") return "Economia";
  if (item.category === "Tech") return "Tech";
  if (item.category === "Cultura") return "Cultura";
  if (item.category === "Entretenimento") return "Entretenimento";
  return "Mundo";
}
