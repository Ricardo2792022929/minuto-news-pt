// Vai buscar o texto da notícia ao site original para dar contexto às APIs de título.
// Tenta várias formas: artigo, dados estruturados, meta, e versão AMP.
const TIMEOUT_MS = 5_000;
const MAX_CHARS = 1_500;

const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "pt-PT,pt;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
};

export async function scrapeArticleText(url: string): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const html = await fetchPage(url);
  if (!html) return null;
  const text = extractBest(html);
  if (text && text.length > 80) return text.slice(0, MAX_CHARS);
  const ampUrl = url.includes("?") ? `${url}&outputType=amp` : `${url}?outputType=amp`;
  const amp = await fetchPage(ampUrl);
  if (amp) {
    const ampText = extractBest(amp);
    if (ampText && ampText.length > 80) return ampText.slice(0, MAX_CHARS);
  }
  return null;
}

async function fetchPage(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: BROWSER_HEADERS, redirect: "follow" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractBest(html: string): string | null {
  const fromJsonLd = extractJsonLd(html);
  if (fromJsonLd && fromJsonLd.length > 100) return fromJsonLd;
  const fromArticle = extractParagraphs(html);
  if (fromArticle && fromArticle.length > 100) return fromArticle;
  const fromMeta = extractMeta(html);
  if (fromMeta && fromMeta.length > 60) return fromMeta;
  return fromArticle || fromMeta || null;
}

function extractJsonLd(html: string): string | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const data = JSON.parse(block[1]);
      const article = Array.isArray(data) ? data.find((d) => d["@type"]?.includes?.("Article") || d["@type"] === "NewsArticle") : data;
      const body = article?.articleBody || article?.description;
      if (typeof body === "string" && body.length > 80) return cleanText(body);
    } catch { /* ignora */ }
  }
  return null;
}

function extractParagraphs(html: string): string | null {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html;
  const paragraphs = [...article.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => cleanText(m[1].replace(/<[^>]+>/g, " ")))
    .filter((p) => p.length > 40 && !/cookie|subscreva|newsletter|publicidade|partilhe|comentário/i.test(p));
  return paragraphs.length ? paragraphs.slice(0, 6).join(" ") : null;
}

function extractMeta(html: string): string | null {
  const og = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const desc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1];
  return cleanText(og || desc || "");
}

function cleanText(raw: string): string {
  return raw
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
