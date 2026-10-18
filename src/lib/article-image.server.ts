import { chooseOriginal } from "./image-dimensions.server";

const LOGO_PATTERN = /logo|placeholder|icon|sprite|ojogo|o-jogo|sapo.*brand|favicon|avatar|default.*image|no-image|sem-imagem/i;

function isLogo(url: string): boolean {
  return LOGO_PATTERN.test(url);
}

/** A fotografia principal da página da notícia, quando a fonte a publica. */
export async function imageFromArticlePage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FlashNoticiasFeed/1.0)", "Accept-Language": "pt-PT" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000);
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
    const chosen = await chooseOriginal([...new Set(candidates)]);
    if (chosen && !isLogo(chosen)) return chosen;
    return candidates.find((url) => [/\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url), !isLogo(url)].every(Boolean)) ?? null;
  } catch {
    return null;
  }
}
