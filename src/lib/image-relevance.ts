/** A imagem tem de corresponder à notícia, não apenas ao tema geral. */

const FOLD = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const GENERIC = new Set([
  "inteligencia", "artificial", "tecnologia", "tecnologico", "computador", "computadores",
  "digital", "internet", "software", "algoritmo", "robot", "robo", "circuito", "circuitos",
  "chip", "chips", "modelo", "modelos", "dados", "nuvem", "smartphone", "telemovel",
  "telefone", "empresa", "mercado", "noticia", "noticias", "governo", "portugal",
  "portugues", "portuguesa", "lisboa", "mundo", "hoje", "ontem", "novo", "nova",
]);

const STOP = new Set([
  "para", "como", "mais", "sobre", "apos", "depois", "antes", "anuncia", "anunciou",
  "apresenta", "apresentou", "diz", "disse", "afirma", "revela", "revelou", "lanca",
  "lancou", "chega", "chegou", "pode", "podem", "deve", "durante", "entre", "contra",
  "com", "sem", "the", "and", "for", "with", "from", "that", "this",
]);

const STOCK = /\b(laptop|notebook|keyboard|coding|programmer|programming|circuit board|motherboard|robot|android|binary|matrix|server room|data cent(?:er|re)|smartphone|businessman|businesswoman|abstract|wallpaper|texture|lines of code|silicon|microchip|office worker)\b/i;

const GENERIC_PAGES = new Set([
  "inteligencia artificial", "artificial intelligence", "tecnologia", "technology",
  "computador", "computer", "smartphone", "telemovel", "robot", "robo", "chip",
  "microchip", "software", "internet", "empresa", "company",
]);

const BRANDS = [
  "nvidia", "apple", "iphone", "ipad", "openai", "chatgpt", "google", "microsoft", "meta",
  "tesla", "samsung", "intel", "amd", "anthropic", "deepmind", "amazon", "netflix",
  "spotify", "xiaomi", "huawei", "sony", "playstation", "xbox", "benfica", "sporting",
  "fc porto", "cristiano ronaldo", "nasa", "spacex",
];

const NAMED: [RegExp, string][] = [
  [/papa\s+le[aã]o|le[aã]o\s+xiv/i, "Pope Leo XIV"],
  [/papa\s+francisco/i, "Pope Francis"],
  [/cristiano\s+ronaldo/i, "Cristiano Ronaldo"],
  [/fc\s+porto|futebol\s+clube\s+do\s+porto/i, "FC Porto"],
];

const PRODUCT = /\b(?:iPhone\s?\d{0,2}(?:\s?(?:Pro|Plus|Air|Max))?|iPad(?:\sPro)?|MacBook(?:\sPro)?|Galaxy\s(?:S|Z|A)?\s?\d{1,2}|Pixel\s?\d{1,2}|GPT-?\d+(?:\.\d+)?|Claude\s?\d*(?:\.\d+)?|Gemini\s?\d*(?:\.\d+)?|RTX\s?\d{3,4}|H100|B200|Blackwell)\b/gi;

function hasTerm(folded: string, term: string): boolean {
  const words = folded.split(" ");
  const tokens = term.split(" ");
  return words.some((_, index) => tokens.every((token, offset) => words[index + offset] === token));
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.replace(/\s+/g, " ").trim();
    const key = FOLD(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

export function namedQuery(title: string): string | null {
  for (const [pattern, query] of NAMED) if (pattern.test(title)) return query;
  return null;
}

/** Empresas, pessoas, produtos e clubes. Um tema genérico não conta como entidade. */
export function storyEntities(title: string, description = ""): string[] {
  const blob = `${title} ${description.slice(0, 360)}`;
  const folded = FOLD(blob);
  const brands = BRANDS.filter((brand) => hasTerm(folded, brand));
  const products = blob.match(PRODUCT) ?? [];
  const proper = title.match(/\b\p{Lu}[\p{L}\d'’.-]{2,}(?:\s+(?:d[aeo]s?|de|e|\p{Lu}[\p{L}\d'’.-]{2,})){0,3}/gu) ?? [];
  const names = proper.filter((name) => {
    const foldedName = FOLD(name);
    return foldedName.length > 2 && !GENERIC.has(foldedName) && !STOP.has(foldedName);
  });
  const named = namedQuery(title);
  return unique([...(named ? [named] : []), ...brands, ...products, ...names]).slice(0, 4);
}

export function distinctiveWords(text: string): string[] {
  return unique(FOLD(text).split(" ").filter((word) => word.length > 4 && !STOP.has(word) && !GENERIC.has(word)));
}

/** Consultas do acontecimento. Nunca pesquisa só “inteligência artificial” ou “tecnologia”. */
export function contextualQueries(title: string, description = ""): string[] {
  const entities = storyEntities(title, description);
  const words = distinctiveWords(title).filter((word) => !entities.some((entity) => FOLD(entity).includes(word)));
  const year = `${title} ${description}`.match(/\b20\d{2}\b/)?.[0];
  const queries: string[] = [];
  const primary = entities[0];
  if (primary) {
    queries.push([primary, ...words.slice(0, 3)].join(" "));
    const second = entities[1];
    if (second) queries.push(`${primary} ${second}`);
    if (year) queries.push(`${primary} ${year}`);
  } else if (words.length >= 2) {
    queries.push(words.slice(0, 4).join(" "));
  }
  return unique(queries).filter((query) => FOLD(query).split(" ").some((word) => !GENERIC.has(word))).slice(0, 3);
}

const TRACKING = /^(w|h|q|fit|auto|crop|ixlib|ixid|width|height|quality|fm|cs|sat|exp|hmac|sig|cb|dpr)$/i;

/** O mesmo ficheiro com parâmetros de tamanho diferentes conta como a mesma imagem. */
export function imageIdentity(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const embedded = decodeURIComponent(parsed.pathname).match(/https?:\/\/.+/);
    const target = embedded ? new URL(embedded[0]) : parsed;
    for (const key of [...target.searchParams.keys()]) {
      if (TRACKING.test(key) || key.toLowerCase().startsWith("utm_")) target.searchParams.delete(key);
    }
    const query = target.searchParams.toString();
    return `${target.hostname}${target.pathname}`.toLowerCase().replace(/\/+$/, "") + (query ? `?${query}` : "");
  } catch {
    return FOLD(url);
  }
}

export function sameImage(left: string, right: string): boolean {
  return imageIdentity(left) === imageIdentity(right);
}

export function rememberImage(used: Set<string>, url: string) {
  used.add(url);
  used.add(imageIdentity(url));
}

export function imageAlreadyUsed(used: Set<string>, url: string): boolean {
  return used.has(url) || used.has(imageIdentity(url));
}

export function wikipediaPageFits(entity: string, pageTitle: string): boolean {
  const page = FOLD(pageTitle);
  const wanted = FOLD(entity);
  if (!page || !wanted || GENERIC_PAGES.has(page)) return false;
  const tokens = wanted.split(" ").filter((word) => word.length > 2);
  return tokens.length > 0 && tokens.every((token) => page.includes(token));
}

export function scoreCandidate(title: string, description: string, candidateText: string, candidateUrl = ""): { score: number; entityHits: number; accepted: boolean } {
  const entities = storyEntities(title, description);
  const words = distinctiveWords(`${title} ${description}`).slice(0, 8);
  let hay = "";
  try { hay = FOLD(`${candidateText} ${decodeURIComponent(candidateUrl)}`); }
  catch { hay = FOLD(`${candidateText} ${candidateUrl}`); }
  let entityHits = 0;
  for (const entity of entities) {
    const tokens = FOLD(entity).split(" ").filter((word) => word.length > 2);
    if (tokens.length > 0 && tokens.every((token) => hay.includes(token))) entityHits++;
  }
  const wordHits = words.filter((word) => hay.includes(word)).length;
  const stock = STOCK.test(`${candidateText} ${candidateUrl}`) && entityHits === 0;
  let score = entityHits * 45 + wordHits * 10;
  if (stock || (entities.length > 0 && entityHits === 0)) score = 0;
  const accepted = !stock && (entities.length > 0 ? entityHits > 0 && score >= 45 : wordHits >= 2 && score >= 20);
  return { score, entityHits, accepted };
}
