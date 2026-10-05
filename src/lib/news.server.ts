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
        return ((acc[1] ?? "") + (marks[acc[2] ?? ""] ?? "")).normalize("NFC");
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

// Deteta miniaturas / imagens de baixa resolução pelo URL
export function isLowResImage(url: string): boolean {
  return /emoji|s\.w\.org|\/\d{2,3}x\d{2,3}\/|\/\d{2,3}$|thumb|small|mini|150x150|300x|[-_x]\d{2,3}x\d{2,3}(?!\d)|[?&](w|width|h|height)=\d{1,3}(&|$)/i.test(url);
}

function extractImage(item: any): string | undefined {
  const candidates: { url: string; w: number; prio: number }[] = [];
  const add = (url: unknown, w: unknown, prio: number) => {
    if (typeof url !== "string" || !url) return;
    const width = Number(w) || 0;
    if (width && width < 600) return; // largura conhecida e baixa → descarta
    candidates.push({ url, w: width, prio });
  };
  const media = [
    ...arrayify(item["media:content"]),
    ...arrayify(item["media:group"]).flatMap((g: any) => arrayify(g?.["media:content"])),
  ];
  for (const m of media) {
    const type = m?.["@_type"] as string | undefined;
    const medium = m?.["@_medium"] as string | undefined;
    if (type && !type.startsWith("image") && medium !== "image") continue;
    add(m?.["@_url"], m?.["@_width"], 3);
    for (const t of arrayify(m?.["media:thumbnail"])) add(t?.["@_url"], t?.["@_width"], 1);
  }
  for (const e of arrayify(item["enclosure"])) {
    const type = e?.["@_type"] as string | undefined;
    if (!type || type.startsWith("image")) add(e?.["@_url"], e?.["@_width"], 3);
  }
  for (const t of arrayify(item["media:thumbnail"])) add(t?.["@_url"], t?.["@_width"], 1);

  // Ordem: enclosure / media:content (maior primeiro) → <img> em content:encoded / description.
  const sorted = candidates.sort((a, b) => b.w - a.w || b.prio - a.prio).map((c) => c.url);
  const html = [firstImg(item["content:encoded"]), firstImg(item["description"])];
  for (const raw of [...sorted, ...html]) {
    if (!raw) continue;
    const url = upgradeImageUrl(raw.replace(/&amp;/g, "&").trim());
    if (/_default\.|default_|placeholder|logo/i.test(url)) continue; // imagens genéricas
    if (!isLowResImage(url)) return url;
  }
  return undefined;
}

// CDNs que redimensionam (RTP, imgix, WordPress Photon): pede a versão HD.
function upgradeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    if (/cdn-images\.rtp\.pt|imgix\.net|i\d\.wp\.com/.test(u.hostname)) {
      for (const k of ["w", "width"]) if (u.searchParams.has(k)) u.searchParams.set(k, "1000");
      if (u.searchParams.has("q")) u.searchParams.set("q", "80");
      u.searchParams.delete("h");
      return u.toString();
    }
  } catch {
    /* URL inválido */
  }
  return url;
}

// ---------- Relevância ----------
const MAJOR_SOURCES = new Set([
  "RTP Notícias", "CNN Portugal", "Observador", "Lusa", "Notícias ao Minuto",
  "SAPO Notícias", "Correio da Manhã", "Renascença", "Expresso", "ECO",
]);
const HOT = [
  "ultima hora", "urgente", "morre", "morreu", "mortos", "ataque", "guerra", "explosao",
  "incendio", "sismo", "detido", "tiroteio", "acidente", "governo", "primeiro-ministro",
  "presidente", "montenegro", "marcelo", "parlamento", "eleicoes", "trump", "putin",
  "ucrania", "israel", "gaza", "benfica", "porto", "sporting", "ronaldo", "selecao",
  "inflacao", "impostos", "salario", "pensoes", "greve", "euromilhoes", "recorde",
  "historico", "choque", "alerta", "ipma", "tempestade", "chuva", "calor", "precos",
  "combustiveis", "habitacao", "sns", "hospital", "escandalo", "policia", "psp", "gnr",
];
const LOW = ["horoscopo", "receita", "passatempo", "publicidade", "patrocinado", "dica", "review", "podcast"];

export function relevanceScore(a: NewsItem): number {
  const t = normalize(a.title);
  let bonus = 0;
  for (const k of HOT) if (t.includes(k)) bonus += 2.5;
  for (const k of LOW) if (t.includes(k)) bonus -= 6;
  if (MAJOR_SOURCES.has(a.source)) bonus += 3;
  if (a.category === "Mundo" || a.category === "Política") bonus += 1.5;
  if (a.image) bonus += 1;
  // pontuação em "horas de vantagem" somada ao tempo de publicação
  return new Date(a.publishedAt).getTime() + Math.min(bonus, 10) * 3600_000;
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
    let publishedAt = dateStr ? new Date(String(dateStr).trim()) : new Date();
    if (Number.isNaN(publishedAt.getTime())) continue;
    // proteção contra datas no futuro (fusos mal indicados pelos jornais)
    if (publishedAt.getTime() > Date.now()) publishedAt = new Date();
    // Descarta notícias com mais de 72 horas
    if (Date.now() - publishedAt.getTime() > 72 * 3600_000) continue;

    const rawExcerpt = String(item?.["description"] ?? item?.["summary"] ?? "");
    const excerpt = stripHtml(rawExcerpt).slice(0, 320);
    const url = decodeEntities(link.trim());

    const entry: NewsItem = {
      id: hashId(url),
      source: feed.source,
      category: classify(title + " " + excerpt, feed.fallbackCategory),
      title,
      excerpt,
      url,
      publishedAt: publishedAt.toISOString(),
    };
    const rawImage = extractImage(item);
    const decoded = rawImage ? decodeEntities(rawImage) : undefined;
    const image = decoded && !/default|placeholder|no-?image/i.test(decoded) ? decoded : undefined;
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
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${feed.source}: HTTP ${res.status}`);
  return parseFeed(
    decodeBody(await res.arrayBuffer(), res.headers.get("content-type")),
    feed,
  );
}

export async function getAllNews(): Promise<NewsItem[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.items;

  // Cada feed isolado: falha/timeout regista e segue para os outros.
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const seen = new Set<string>();
  const perSource = new Map<string, NewsItem[]>();
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      console.error("feed falhou:", FEEDS[i]?.source, String(r.reason));
      return;
    }
    for (const item of r.value) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const list = perSource.get(item.source) ?? [];
      list.push(item);
      perSource.set(item.source, list);
    }
  });
  // Round-robin: mais recentes de cada fonte, intercalados (1 de cada fonte por ronda).
  const lists = [...perSource.values()].map((l) =>
    l.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)),
  );
  const items: NewsItem[] = [];
  for (let round = 0; lists.some((l) => l.length > round); round++) {
    for (const l of lists) if (l[round]) items.push(l[round]!);
  }

  cache = { items, fetchedAt: Date.now() };
  return items;
}
