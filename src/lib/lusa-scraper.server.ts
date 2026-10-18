import type { NewsItem } from "./news.types";

export async function scrapeLusa(): Promise<NewsItem[]> {
  const items: NewsItem[] = [];
  const pages = ["national", "economia", "international", "desporto"];
  for (const page of pages) {
    try {
      const res = await fetch(`https://www.lusa.pt/${page}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FlashNoticias/1.0)" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const matches = [...html.matchAll(/href=['"]([^'"]*\/article\/[^'"]+)['"][^>]*>([^<]{15,})/gi)];
      for (const m of matches.slice(0, 5)) {
        const url = m[1].startsWith("http") ? m[1] : `https://www.lusa.pt${m[1]}`;
        const title = m[2].trim();
        if (title.length < 15) continue;
        items.push({
          id: "lusa-" + url.slice(-20),
          source: "Lusa",
          category: page === "desporto" ? "Desporto" : page === "economia" ? "Economia" : "Mundo",
          title,
          excerpt: "",
          url,
          publishedAt: new Date().toISOString(),
        });
      }
    } catch { /* ignora */ }
  }
  console.log("Lusa scraper found:", items.length, "items");
  return items.slice(0, 10);
}
