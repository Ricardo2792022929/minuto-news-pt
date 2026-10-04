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

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", euro: "€",
  ordm: "º", ordf: "ª", deg: "°", middot: "·", bull: "•",
};

function decodeEntities(s: string): string {
  // duas passagens para entidades duplamente codificadas (&amp;#8211;)
  for (let i = 0; i < 2; i++) {
    s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try {
          return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        } catch {
          return m;
        }
      }
      const low = e.toLowerCase();
      if (NAMED[low]) return NAMED[low];
      // letras acentuadas: aacute, ccedil, atilde, etc.
      const acc = e.match(/^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil)$/);
      if (acc) {
        const marks: Record<string, string> = {
          acute: "\u0301", grave: "\u0300", circ: "\u0302",
          tilde: "\u0303", uml: "\u0308", cedil: "\u0327",
        };
        return (acc[1] + marks[acc[2]]).normalize("NFC");
      }
      return m;
    });
  }
  return s;
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]*>/g, " "))
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstImg(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const m = decodeEntities(String(html)).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m?.[1] ? decodeEntities(m[1]) : undefined;
}

const STOP = new Set(
  "de da do das dos a o as os e em no na nos nas um uma por para com que se ao aos sobre mais após apos entre como sem foi ser são sao está esta diz the".split(" "),
);
const CATEGORY_EN: Record<string, string> = {
  Política: "politics", Economia: "economy", Desporto: "sport",
  Mundo: "world", Cultura: "culture", Tech: "technology",
};

function fallbackImage(title: string, category: string, id: string): string {
  const words = normalize(title)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
    .slice(0, 2);
  const tags = [CATEGORY_EN[category] ?? "news", ...words].join(",");
  const lock = Math.abs(parseInt(id.slice(1), 36) || 1) % 100000;
  return `https://loremflickr.com/800/1200/${encodeURIComponent(tags)}?lock=${lock}`;
}

function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
  const head = new TextDecoder("latin1").decode(buf.slice(0, 300));
  const cs =
    contentType?.match(/charset=([\w-]+)/i)?.[1] ??
    head.match(/encoding=["']([\w-]+)["']/i)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(cs.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
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
