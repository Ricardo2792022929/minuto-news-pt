import { XMLParser } from "fast-xml-parser";

export interface NewsItem {
  id: string;
  source: string;
  category: string;
  title: string;
  excerpt: string;
  url: string;
  publishedAt: string;
  image?: string;
}

interface FeedConfig {
  url: string;
  source: string;
  fallbackCategory: string;
}

// Fontes portuguesas com feed de notícias ativo (lista fornecida pelo utilizador)
export const FEEDS: FeedConfig[] = [
  { url: "https://www.rtp.pt/noticias/rss", source: "RTP Notícias", fallbackCategory: "Mundo" },
  { url: "https://cnnportugal.iol.pt/rss", source: "CNN Portugal", fallbackCategory: "Mundo" },
  { url: "https://observador.pt/rss/geral/", source: "Observador", fallbackCategory: "Mundo" },
  { url: "https://www.lusa.pt/rss", source: "Lusa", fallbackCategory: "Mundo" },
  { url: "https://www.cmjornal.pt/rss", source: "Correio da Manhã", fallbackCategory: "Mundo" },
  { url: "https://www.noticiasaominuto.com/rss", source: "Notícias ao Minuto", fallbackCategory: "Mundo" },
  { url: "https://noticias.sapo.pt/rss", source: "SAPO Notícias", fallbackCategory: "Mundo" },
  { url: "https://eco.sapo.pt/rss/now/", source: "ECO", fallbackCategory: "Economia" },
  { url: "https://www.jornaldenegocios.pt/rss", source: "Jornal de Negócios", fallbackCategory: "Economia" },
  { url: "https://www.record.pt/rss", source: "Record", fallbackCategory: "Desporto" },
  { url: "https://maisfutebol.iol.pt/rss", source: "Maisfutebol", fallbackCategory: "Desporto" },
  { url: "https://www.nit.pt/rss", source: "NiT", fallbackCategory: "Cultura" },
  { url: "https://tek.sapo.pt/rss", source: "SAPO TEK", fallbackCategory: "Tech" },
  { url: "https://zap.aeiou.pt/rss", source: "ZAP.aeiou", fallbackCategory: "Tech" },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/"/gi, '"')
    .replace(/&#0?39;|'|&rsquo;/gi, "'")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/&hellip;/gi, "…")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstImg(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1].replace(/&/g, "&") : undefined;
}

function extractImage(item: Record<string, unknown>): string | undefined {
  const media = arrayify(item["media:content"] as Record<string, unknown>);
  for (const m of media) {
    const url = m?.["@_url"];
    if (typeof url === "string") return url;
  }
  const thumbs = arrayify(item["media:thumbnail"] as Record<string, unknown>);
  for (const t of thumbs) {
    const url = t?.["@_url"];
    if (typeof url === "string") return url;
  }
  const enclosures = arrayify(item.enclosure as Record<string, unknown>);
  for (const e of enclosures) {
    const type = e?.["@_type"] as string | undefined;
    const url = e?.["@_url"];
    if (typeof url === "string" && (!type || type.startsWith("image"))) return url;
  }
  return (
    firstImg(item["content:encoded"] as string) ??
    firstImg(item.description as string)
  );
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function classify(text: string, fallback: string): string {
  const t = normalize(text);
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  if (
    has(
      "desporto", "futebol", "sporting", "benfica", "porto", "golo", "liga ",
      "taça", "seleção", "ronaldo", "ténis", "fórmula 1", "nba", "ciclismo",
      "atletismo", "voleibol", "basquetebol", "treinador", "jogador", "clássico",
      "champions", "crl", "futsal", "rally", "volar", "estádio",
    )
  )
    return "Desporto";
  if (
    has(
      "economia", "psi", "inflação", "inflacao", "imposto", "irs", "iva",
      "desemprego", "bolsa", "salário", "salario", "pib", "bce", "banco central",
      "turismo", "gasolina", "combustível", "combustivel", "preços", "precos",
      "negócios", "negocios", "bancos", "dívida", "divida", "orçamento",
    )
  )
    return "Economia";
  if (
    has(
      "parlamento", "governo", "ministro", "primeiro-ministro", "eleições",
      "eleicoes", "deputados", "orçamento do estado", "presidente da república",
      "política", "politica", "psd", "chega", "cdu", "bloco de esquerda",
      "presidência", "presidencia", "assembleia",
    )
  )
    return "Política";
  if (
    has(
      "tecnologia", "inteligência artificial", "inteligencia artificial",
      "smartphone", "cyber", "cibersegurança", "ciberseguranca", "nvidia",
      "openai", "chatgpt", "google", "apple", "samsung", "huawei", "facebook",
      "instagram", "tiktok", "chip", "semicondutor", "startup", "app ",
      "aplicação", "aplicacao",
    )
  )
    return "Tech";
  if (
    has(
      "festival", "cinema", "filme", "música", "musica", "concerto", "livro",
      "exposição", "exposicao", "teatro", "gala", "artista", "prémio nobel",
      "premio nobel", "espetaáculo", "espetaculo", "cultura",
    )
  )
    return "Cultura";
  if (
    has(
      "ucrânia", "ucrania", "israel", "gaza", "bruxelas", "eua", "trump",
      "china", "rússia", "russia", "onu", "nato", "união europeia", "uniao europeia",
      "guerra", "cimeira", "mundo", "global",
    )
  )
    return "Mundo";
  return fallback;
}

function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "n" + Math.abs(h).toString(36);
}

function parseFeed(xml: string, feed: FeedConfig): NewsItem[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  const rss = parsed.rss as { channel?: { item?: unknown } } | undefined;
  const atom = parsed.feed as { entry?: unknown } | undefined;
  const rawItems = arrayify(rss?.channel?.item ?? atom?.entry) as Record<
    string,
    unknown
  >[];

  const items: NewsItem[] = [];
  for (const item of rawItems) {
    const title = stripHtml((item.title as string) ?? "");
    const link = (item.link as string) ?? item["@_href"] ?? "";
    if (!title || !link) continue;

    const dateStr =
      (item.pubDate as string) ??
      (item.published as string) ??
      (item.updated as string) ??
      (item["dc:date"] as string) ??
      "";
    const publishedAt = dateStr ? new Date(dateStr) : new Date();
    if (Number.isNaN(publishedAt.getTime())) continue;
    // Descarta notícias com mais de 72 horas
    if (Date.now() - publishedAt.getTime() > 72 * 3600_000) continue;

    const rawExcerpt =
      (item.description as string) ?? (item.summary as string) ?? "";
    const excerpt = stripHtml(rawExcerpt).slice(0, 320);
    const url = link.replace(/&/g, "&");

    items.push({
      id: hashId(url),
      source: feed.source,
      category: classify(title + " " + excerpt, feed.fallbackCategory),
      title,
      excerpt,
      url,
      publishedAt: publishedAt.toISOString(),
      image: extractImage(item),
    });
  }
  return items;
}

interface Cache {
  items: NewsItem[];
  fetchedAt: number;
}

let cache: Cache | null = null;
const CACHE_TTL = 2 * 60_000; // 2 minutos

async function fetchFeed(feed: FeedConfig): Promise<NewsItem[]> {
  const res = await fetch(feed.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AoMinutoFeed/1.0; +https://lovable.app)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${feed.source}: HTTP ${res.status}`);
  return parseFeed(await res.text(), feed);
}

export async function getAllNews(): Promise<NewsItem[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.items;

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const byId = new Map<string, NewsItem>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const existing = byId.get(item.id);
      if (!existing || item.source.length < existing.source.length) {
        byId.set(item.id, item);
      }
    }
  }
  const items = [...byId.values()].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  cache = { items, fetchedAt: Date.now() };
  return items;
}
