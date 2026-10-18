import { chooseOriginal } from "./image-dimensions.server";

const LOGO_PATTERN = /logo|placeholder|icon|sprite|ojogo|o-jogo|sapo.*brand|favicon|avatar|default.*image|no-image|sem-imagem|brand|thumb.*logo|jogo.*logo|jog.*logo|site.*logo|header.*logo|nav.*logo|footer.*logo/i;

function isLogo(url: string): boolean {
  return LOGO_PATTERN.test(url);
}

/** Procura a mesma notícia noutro site e devolve a imagem. */
export async function imageFromSameStory(title: string): Promise<string | null> {
  if (!title || title.length < 10) return null;
  try {
    const query = encodeURIComponent(title.slice(0, 80));
    const res = await fetch(`https://news.google.com/rss/search?q=${query}&hl=pt-PT&gl=PT&ceid=PT:pt`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FlashNoticias/1.0)" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const links = [...xml.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]).filter((l) => l.startsWith("http") && !l.includes("news.google.com"));
    for (const link of links.slice(0, 2)) {
      if (/rtp\.pt/i.test(link)) continue;
      const img = await imageFromArticlePage(link);
      if (img && !isLogo(img)) return img;
    }
  } catch { /* ignora */ }
  return null;
}
export async function imageFromArticlePage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(4000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 300_000);
    const candidates: string[] = [];
    for (const meta of html.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = meta[0];
      const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!property || !["og:image", "og:image:secure_url", "twitter:image"].includes(property)) continue;
      const value = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&/g, "&");
      if (!value) continue;
      try {
        const imageUrl = new URL(value, pageUrl);
        if (imageUrl.protocol === "https:") candidates.push(imageUrl.toString());
      } catch { /* metadado inválido */ }
    }
    for (const img of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
      const src = img[1];
      if (!src || /logo|icon|sprite|avatar|placeholder/i.test(src)) continue;
      if (!/\.(?:jpe?g|png|webp)/i.test(src) && !/cdn-images\.rtp\.pt/i.test(src)) continue;
      try {
        const imageUrl = new URL(src, pageUrl);
        if (imageUrl.protocol === "https:") candidates.push(imageUrl.toString());
      } catch { /* ignora */ }
    }
    const chosen = await chooseOriginal([...new Set(candidates)]);
    if (chosen && !isLogo(chosen)) return chosen;
    const real = candidates.find((url) => [/\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url) || /cdn-images\.rtp\.pt/i.test(url), !isLogo(url)].every(Boolean));
    if (real) return real;
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}
