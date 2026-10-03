import { XMLParser } from "fast-xml-parser";
import type { NewsItem } from "./news.types";

export type { NewsItem };


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
  // Fontes adicionadas posteriormente (testadas e ativas)
  { url: "https://www.iol.pt/rss", source: "IOL", fallbackCategory: "Mundo" },
  { url: "https://rr.pt/rss", source: "Renascença", fallbackCategory: "Mundo" },
  { url: "https://madremedia.pt/feed/", source: "MadreMedia", fallbackCategory: "Mundo" },
  { url: "https://shifter.pt/feed/", source: "Shifter", fallbackCategory: "Mundo" },
  { url: "https://fumaca.pt/feed/", source: "Fumaça", fallbackCategory: "Mundo" },
  { url: "https://24noticias.sapo.pt/feed", source: "24 Notícias", fallbackCategory: "Mundo" },
  { url: "https://executivedigest.sapo.pt/feed/", source: "Executive Digest", fallbackCategory: "Economia" },
  { url: "https://www.sabado.pt/rss", source: "Sábado", fallbackCategory: "Cultura" },
  { url: "https://visao.pt/feed/", source: "Visão", fallbackCategory: "Cultura" },
  { url: "https://www.atelevisao.com/feed/", source: "A Televisão", fallbackCategory: "Cultura" },
  { url: "https://www.hiper.fm/feed/", source: "Hiper FM", fallbackCategory: "Cultura" },
  { url: "https://pplware.sapo.pt/feed/", source: "Pplware", fallbackCategory: "Tech" },
  { url: "https://www.pcguia.pt/feed/", source: "PC Guia", fallbackCategory: "Tech" },
  { url: "https://visao.pt/exameinformatica/feed/", source: "Exame Informática", fallbackCategory: "Tech" },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/* eslint-disable @typescript-eslint/no-explicit-any */

function arrayify(value: any): any[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/"|&#0?34;/gi, '"')
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
  const src = m?.[1];
  return src ? src.replace(/&/g, "&") : undefined;
}

function extractImage(item: any): string | undefined {
  for (const m of arrayify(item["media:content"])) {
    const url = m?.["@_url"];
    if (typeof url === "string") return url;
  }
  for (const t of arrayify(item["media:thumbnail"])) {
    const url = t?.["@_url"];
    if (typeof url === "string") return url;
  }
  for (const e of arrayify(item["enclosure"])) {
    const type = e?.["@_type"] as string | undefined;
    const url = e?.["@_url"];
    if (typeof url === "string" && (!type || type.startsWith("image"))) return url;
  }
  return (
    firstImg(item["content:encoded"]) ?? firstImg(item["description"])
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
      "champions", "futsal", "rally", "estádio",
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
      "instagram", "tiktok", "chip", "semicondutor", "startup",
      "aplicação", "aplicacao",
    )
  )
    return "Tech";
  if (
    has(
      "festival", "cinema", "filme", "música", "musica", "concerto", "livro",
      "exposição", "exposicao", "teatro", "gala", "artista", "prémio nobel",
      "premio nobel", "espetáculo", "espetaculo", "cultura",
    )
  )
    return "Cultura";
  if (
    has(
      "ucrânia", "ucrania", "israel", "gaza", "bruxelas", "eua", "trump",
      "china", "rússia", "russia", "onu", "nato", "união europeia", "uniao europeia",
      "guerra", "cimeira",
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
  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }
  const rawItems = arrayify(
    parsed?.rss?.channel?.item ?? parsed?.feed?.entry,
  );

  const items: NewsItem[] = [];
  for (const item of rawItems) {
    const title = stripHtml(String(item?.["title"] ?? ""));
    const link = String(item?.["link"] ?? item?.["@_href"] ?? "");
    if (!title || !link) continue;

    const dateStr =
      item?.["pubDate"] ?? item?.["published"] ?? item?.["updated"] ?? item?.["dc:date"] ?? "";
    const publishedAt = dateStr ? new Date(String(dateStr)) : new Date();
    if (Number.isNaN(publishedAt.getTime())) continue;
    // Descarta notícias com mais de 72 horas
    if (Date.now() - publishedAt.getTime() > 72 * 3600_000) continue;

    const rawExcerpt = String(item?.["description"] ?? item?.["summary"] ?? "");
    const excerpt = stripHtml(rawExcerpt).slice(0, 320);
    const url = link.replace(/&/g, "&");

    const entry: NewsItem = {
      id: hashId(url),
      source: feed.source,
      category: classify(title + " " + excerpt, feed.fallbackCategory),
      title,
      excerpt,
      url,
      publishedAt: publishedAt.toISOString(),
    };
    const image = extractImage(item);
    if (image) entry.image = image;
    items.push(entry);
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
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  const items = [...byId.values()].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  cache = { items, fetchedAt: Date.now() };
  return items;
}
