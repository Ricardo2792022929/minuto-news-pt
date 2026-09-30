import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

export interface ArticleContent {
  paragraphs: string[];
  image?: string;
  author?: string;
}

const cache = new Map<string, { data: ArticleContent; at: number }>();
const TTL = 30 * 60_000;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Frases típicas de rodapé/partilha que não fazem parte da notícia
const NOISE =
  /^(partilhe|partilhar|leia também|leia mais|veja também|subscreva|siga-nos|publicidade|comentários|newsletter|clique aqui|ler mais|saiba mais)/i;

export async function fetchArticle(url: string): Promise<ArticleContent> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "pt-PT,pt;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const { document } = parseHTML(html);
  const ogImage =
    document.querySelector('meta[property="og:image"]')?.getAttribute("content") ??
    undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = new Readability(document as any, { charThreshold: 200 });
  const parsed = reader.parse();

  let paragraphs: string[] = [];
  if (parsed?.content) {
    const { document: frag } = parseHTML(
      `<!doctype html><html><body>${parsed.content}</body></html>`,
    );
    paragraphs = [...frag.querySelectorAll("p, h2, h3, blockquote, li")]
      .map((el) => clean(el.textContent ?? ""))
      .filter((t) => t.length > 25 && !NOISE.test(t));
  }
  if (!paragraphs.length && parsed?.textContent) {
    paragraphs = parsed.textContent
      .split(/\n{2,}/)
      .map(clean)
      .filter((t) => t.length > 25);
  }
  // Remove duplicados mantendo a ordem
  paragraphs = [...new Set(paragraphs)];

  const data: ArticleContent = { paragraphs };
  if (ogImage) data.image = ogImage;
  if (parsed?.byline) data.author = clean(parsed.byline);
  cache.set(url, { data, at: Date.now() });
  return data;
}
