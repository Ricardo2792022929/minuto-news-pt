// Vai buscar o texto da notícia ao site original para dar contexto às APIs de título.
const TIMEOUT_MS = 4_000;
const MAX_CHARS = 1_500;

export async function scrapeArticleText(url: string): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; FlashNoticias/1.0)", accept: "text/html" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = extractText(html);
    return text.length > 80 ? text.slice(0, MAX_CHARS) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractText(html: string): string {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html;
  const paragraphs = [...article.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&/g, "&").replace(/"/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 40 && !/cookie|subscreva|newsletter|publicidade/i.test(p));
  return paragraphs.slice(0, 6).join(" ");
}
