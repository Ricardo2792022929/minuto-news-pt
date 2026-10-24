import { XMLParser } from "fast-xml-parser";
import { scrapeLusa } from "./lusa-scraper.server";
import type { NewsItem } from "./news.types";

export type { NewsItem };


function canonicalArticleUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|source)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return raw.trim();
  }
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
  { url: "https://www.cmjornal.pt/rss", source: "Correio da Manhã", fallbackCategory: "Mundo" },
  { url: "https://www.noticiasaominuto.com/rss", source: "Notícias ao Minuto", fallbackCategory: "Mundo" },
  { url: "https://noticias.sapo.pt/rss", source: "SAPO Notícias", fallbackCategory: "Mundo" },
  { url: "https://eco.sapo.pt/feed/", source: "ECO", fallbackCategory: "Economia" },
  { url: "https://www.jornaldenegocios.pt/rss", source: "Jornal de Negócios", fallbackCategory: "Economia" },
  { url: "https://jornaleconomico.sapo.pt/feed/", source: "Jornal Económico", fallbackCategory: "Economia" },
  { url: "https://www.record.pt/rss", source: "Record", fallbackCategory: "Desporto" },
  { url: "https://maisfutebol.iol.pt/rss", source: "Maisfutebol", fallbackCategory: "Desporto" },
  { url: "https://www.nit.pt/rss", source: "NiT", fallbackCategory: "Mundo" },
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
  { url: "https://www.sabado.pt/rss", source: "Sábado", fallbackCategory: "Mundo" },
  { url: "https://visao.pt/feed/", source: "Visão", fallbackCategory: "Mundo" },
  { url: "https://www.atelevisao.com/feed/", source: "A Televisão", fallbackCategory: "Mundo" },
  { url: "https://www.hiper.fm/feed/", source: "Hiper FM", fallbackCategory: "Mundo" },
  { url: "https://pplware.sapo.pt/feed/", source: "Pplware", fallbackCategory: "Tech" },
  { url: "https://www.pcguia.pt/feed/", source: "PC Guia", fallbackCategory: "Tech" },
  { url: "https://visao.pt/exameinformatica/feed/", source: "Exame Informática", fallbackCategory: "Tech" },
  { url: "https://www.publico.pt/rss", source: "Público", fallbackCategory: "Mundo" },
  { url: "https://www.dn.pt/rss", source: "Diário de Notícias", fallbackCategory: "Mundo" },
  { url: "https://www.jn.pt/rss", source: "Jornal de Notícias", fallbackCategory: "Mundo" },
  { url: "https://expresso.pt/rss", source: "Expresso", fallbackCategory: "Mundo" },
  { url: "https://www.tsf.pt/rss", source: "TSF", fallbackCategory: "Mundo" },
  { url: "https://sicnoticias.pt/rss/", source: "SIC Notícias", fallbackCategory: "Mundo" },
  { url: "https://www.abola.pt/rss", source: "A Bola", fallbackCategory: "Desporto" },
  { url: "https://www.ojogo.pt/rss", source: "O Jogo", fallbackCategory: "Desporto" },
  { url: "https://www.acorianooriental.pt/feed/rss.xml", source: "Açoriano Oriental", fallbackCategory: "Mundo" },
  { url: "https://ominho.pt/feed/", source: "O Minho", fallbackCategory: "Mundo" },
  { url: "https://www.sulinformacao.pt/feed/", source: "Sul Informação", fallbackCategory: "Mundo" },
  { url: "https://www.dnoticias.pt/rss", source: "Diário de Notícias da Madeira", fallbackCategory: "Mundo" },
  { url: "https://www.diariocoimbra.pt/feed/", source: "Diário de Coimbra", fallbackCategory: "Mundo" },
  { url: "https://www.avozdetrasosmontes.pt/feed/", source: "A Voz de Trás-os-Montes", fallbackCategory: "Mundo" },
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
  const source = decodeEntities(String(html));
  const tag = source.match(/<img\\b[^>]*>/i)?.[0];
  if (!tag) return undefined;
  // Muitos feeds usam lazy loading ou colocam src depois de outros atributos.
  const srcset = tag.match(/\\b(?:srcset|data-srcset)=["']([^"']+)["']/i)?.[1];
  if (srcset) {
    const best = srcset.split(",").map((part) => {
      const [url, descriptor] = part.trim().split(/\\s+/);
      return { url, width: Number(descriptor?.replace(/w$/, "")) || 0 };
    }).sort((a, b) => b.width - a.width)[0]?.url;
    if (best) return decodeEntities(best);
  }
  const match = tag.match(/\\b(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/i);
  return match?.[1] ? decodeEntities(match[1]) : undefined;
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

function extractImages(item: any): string[] {
  const candidates: { url: string; w: number; prio: number }[] = [];
  const add = (url: unknown, w: unknown, prio: number) => {
    if (typeof url !== "string" || !url) return;
    const width = Number(w) || 0;
    if (width && width < 480) return;
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
    const enclosureUrl = e?.["@_url"] as string | undefined;
    if ((!type || type.startsWith("image")) && enclosureUrl) add(enclosureUrl, e?.["@_width"], 3);
  }
  for (const t of arrayify(item["media:thumbnail"])) add(t?.["@_url"], t?.["@_width"], 1);

  // Ordem: enclosure / media:content (maior primeiro) → <img> em content:encoded / description.
  const sorted = candidates.sort((a, b) => b.w - a.w || b.prio - a.prio).map((c) => c.url);
  const html = [item["content:encoded"], item["description"]].flatMap((value) => {
    const content = decodeEntities(String(value ?? ""));
    const srcset = content.match(/<img[^>]+srcset=["']([^"']+)["']/i)?.[1];
    const variants = (srcset ?? "").split(",").map((part) => {
      const [url, descriptor] = part.trim().split(/\s+/);
      return { url, width: Number(descriptor?.replace(/w$/, "")) || 0 };
    }).sort((a, b) => b.width - a.width).map((variant) => variant.url);
    return [...variants, firstImg(value)];
  });
  const result: string[] = [];
  const logos: string[] = [];
  for (const raw of [...sorted, ...html]) {
    if (!raw) continue;
    const url = upgradeImageUrl(raw.replace(/&amp;/g, "&").trim());
    if (isLowResImage(url)) continue;
    if (/_default\.|default_|placeholder|logo|ojogo|o-jogo|favicon|brand|sapo.*logo|jogo.*logo|jog.*logo|site.*logo|header.*logo/i.test(url)) logos.push(url);
    else result.push(url);
  }
  return [...new Set(result.length ? result : logos)];
}

// CDNs que redimensionam (RTP, imgix, WordPress Photon): pede a versão maior.
function upgradeImageUrl(url: string): string {
  const full = url.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)(?:$|\?))/i, "");
  try {
    const u = new URL(full);
    if (/cdn-images\.rtp\.pt|imgix\.net|i\d\.wp\.com/.test(u.hostname)) {
      for (const k of ["w", "width"]) if (u.searchParams.has(k)) u.searchParams.set(k, "1600");
      if (u.searchParams.has("q")) u.searchParams.set("q", "80");
      u.searchParams.delete("h");
      return u.toString();
    }
    for (const k of ["w", "width"]) {
      const value = Number(u.searchParams.get(k));
      if (value && value < 1000) u.searchParams.set(k, "1600");
    }
    return u.toString();
  } catch {
    return full;
  }
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

export function classify(text: string, fallback: string): string {
  const t = normalize(text);
  const cats = ["Desporto", "Economia", "Política", "Tech", "Cultura", "Mundo"] as const;
  const strong: Record<string, string[]> = {
    Desporto: ["futebol", "futebolista", "golo", "golos", "liga portugal", "primeira liga", "liga dos campeoes", "champions", "benfica", "sporting", "fc porto", "cristiano ronaldo", "ronaldo", "tenis", "formula 1", "formula1", "nba", "ciclismo", "atletismo", "voleibol", "basquetebol", "futsal", "andebol", "arbitro", "derby", "dragao", "desporto", "campeonato", "jornada", "taca de portugal", "mundial", "olimpiadas", "selecionador", "plantel", "baliza", "boavista", "gil vicente", "famalicao", "casa pia", "moreirense", "rio ave", "maritimo", "motogp", "ufc", "hoquei", "maratona", "canoagem", "canoista", "classico"],
    Economia: ["inflacao", "imposto", "irs", "irc", "desemprego", "bolsa", "salario", "salarios", "salario minimo", "ordenado", "pib", "banco central", "bce", "euribor", "divida publica", "orcamento", "juros", "combustivel", "gasolina", "gasoleo", "falencia", "lucros", "prejuizo", "dividendos", "acoes", "psi", "exportacoes", "importacoes", "deficit", "investimento", "despedimentos", "layoff", "spread", "hipoteca", "eletricidade", "brent", "petroleo", "rating", "moodys", "poder de compra", "contas publicas"],
    Política: ["habitacao", "arrendamento", "despejo", "manifestacao", "manifestantes", "manifestam", "parlamento", "governo", "ministro", "primeiro-ministro", "eleicoes", "deputado", "deputados", "assembleia", "autarquicas", "greve", "sindicato", "sns", "hospital", "escola", "professor", "professores", "tribunal", "policia", "saude", "pensoes"],
    Tech: ["inteligencia artificial", "ciberseguranca", "ciberataque", "smartphone", "telemovel", "nvidia", "openai", "chatgpt", "semicondutor", "startup", "software"],
    Cultura: ["cinema", "filme", "filmes", "musica", "concerto", "concertos", "livro", "livros", "teatro", "festival", "festivais", "exposicao", "artista", "artistas", "espetaculo", "museu", "museus", "netflix", "oscar", "oscares", "grammy", "cancao", "album", "banda", "cantor", "cantora", "escritor", "escritora", "literatura", "patrimonio", "orquestra", "fado", "realizador", "realizadora", "estreia", "bilheteira", "pintura", "escultura", "poeta", "poesia", "documentario", "novela", "telenovela", "galeria", "opera", "ballet", "compositor", "eurovisao", "cannes"],
    Mundo: ["ucrania", "israel", "gaza", "trump", "putin", "zelensky", "russia", "china", "nato", "bruxelas", "cimeira", "hamas"],
  };
  const weak: Record<string, string[]> = {
    Desporto: ["treinador", "jogador", "estadio", "selecao", "venceu", "derrota", "empate", "goleador", "guarda-redes", "avancado"],
    Economia: ["precos", "banco", "empresa", "turismo", "iva", "cabaz", "supermercado", "fatura"],
    Política: ["presidente", "partido", "lei"],
    Tech: ["google", "apple", "samsung", "facebook", "instagram", "tiktok"],
    Cultura: ["gala", "premio", "ator", "atriz", "serie", "series", "danca", "bienal"],
    Mundo: ["eua", "europa", "guerra", "alemanha", "franca", "espanha"],
  };
  const hit = (phrase: string) => {
    const n = normalize(phrase);
    if (n.includes(" ")) return t.includes(n);
    if (n.length <= 5) return new RegExp(`(?:^|\\s)${n}(?:\\s|$)`).test(t);
    return t.includes(n);
  };
  const scores: Record<string, number> = {};
  const strongHits: Record<string, number> = {};
  for (const cat of cats) {
    const found = strong[cat].filter(hit).length;
    strongHits[cat] = found;
    let score = found * 4;
    score += weak[cat].filter(hit).length * 2;
    scores[cat] = score;
  }
  if (hit("serie") && t.includes("serie de") && strongHits.Cultura <= 1) scores.Cultura = 0;
  if (/(assalto|roubo|homicidio)/.test(t)) scores.Economia = Math.min(scores.Economia, strongHits.Economia * 4);
  if (strongHits.Economia > 0 && strongHits.Política > 0) scores.Economia += 3;
  // «Porto» e «Braga» sozinhos são cidades. Só contam como desporto com mais um sinal.
  if (strongHits.Desporto > 0 && (hit("porto") || hit("braga") || hit("guimaraes"))) scores.Desporto += 2;
  const civic = ["habitacao", "arrendamento", "despejo", "manifestantes", "manifestacao", "manifestam"].some(hit);
  if (civic && strongHits.Desporto === 0) scores.Desporto = 0;
  if (strongHits.Desporto > 0 && !civic) scores.Cultura = 0;
  if (weak.Desporto.filter(hit).length > 0 && strongHits.Cultura === 0 && !civic) {
    scores.Cultura = 0;
    scores.Desporto += 3;
  }
  if (cats.includes(fallback as (typeof cats)[number]) && fallback !== "Cultura") scores[fallback] += 1;
  const best = [...cats].sort((a, b) => scores[b] - scores[a] || Number(b === "Política") - Number(a === "Política"))[0];
  if (scores[best] < 3) {
    if (fallback === "Economia" && (strongHits.Economia > 0 || weak.Economia.some(hit))) return "Economia";
    if (fallback === "Cultura" && (strongHits.Cultura > 0 || weak.Cultura.some(hit))) return "Cultura";
    if (fallback === "Cultura" || fallback === "Economia") return "Mundo";
    return cats.includes(fallback as (typeof cats)[number]) ? fallback : "Mundo";
  }
  if (strongHits.Desporto > 0 && !civic) return "Desporto";
  return best;
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
    if (!dateStr) continue;
    let publishedAt = new Date(String(dateStr).trim());
    if (Number.isNaN(publishedAt.getTime())) continue;
    // proteção contra datas no futuro (fusos mal indicados pelos jornais)
    if (publishedAt.getTime() > Date.now()) publishedAt = new Date();
    // Descarta notícias com mais de 72 horas
    if (Date.now() - publishedAt.getTime() > 72 * 3600_000) continue;

    const rawExcerpt = String(item?.["description"] ?? item?.["summary"] ?? "");
    const excerpt = stripHtml(rawExcerpt).slice(0, 320);
    const url = decodeEntities(link.trim());
    const canonicalUrl = canonicalArticleUrl(url);

    const entry: NewsItem = {
      id: hashId(canonicalUrl),
      source: feed.source,
      category: classify(title + " " + excerpt, feed.fallbackCategory),
      title,
      excerpt,
      url,
      publishedAt: publishedAt.toISOString(),
    };
    const imageCandidates = extractImages(item).map(decodeEntities).filter((url) => !/default|placeholder|no-?image/i.test(url));
    const decoded = imageCandidates[0];
    const image = decoded && !/default|placeholder|no-?image/i.test(decoded) ? decoded : undefined;
    if (image) entry.image = image;
    if (imageCandidates.length) entry.imageCandidates = imageCandidates;
    items.push(entry);
  }
  return items;
}

interface Cache {
  items: NewsItem[];
  fetchedAt: number;
}

let cache: Cache | null = null;
const CACHE_TTL = 60_000; // cache inferior ao ciclo de ingestão de 90 segundos

async function fetchFeed(feed: FeedConfig): Promise<NewsItem[]> {
  const res = await fetch(feed.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FlashNoticiasFeed/1.0; +https://lovable.app)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(5000),
    redirect: "follow",
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
  const results = await Promise.allSettled([...FEEDS.map(fetchFeed), scrapeLusa()]);
  const seen = new Set<string>();
  const perSource = new Map<string, NewsItem[]>();
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      console.error("feed falhou:", i < FEEDS.length ? FEEDS[i]?.source : "Lusa scraper", String(r.reason));
      return;
    }
    for (const item of r.value) {
      const canonicalUrl = canonicalArticleUrl(item.url);
      if (seen.has(canonicalUrl)) continue;
      seen.add(canonicalUrl);
      const list = perSource.get(item.source) ?? [];
      list.push(item);
      perSource.set(item.source, list);
    }
  });
  // Ordenação global, sem round-robin: data de publicação sempre decrescente.
  const items = [...perSource.values()].flat()
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));

  cache = { items, fetchedAt: Date.now() };
  return items;
}
