import type { NewsItem } from "./news.types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGES: { page: string; category: string }[] = [
  { page: "national", category: "Mundo" },
  { page: "economia", category: "Economia" },
  { page: "international", category: "Mundo" },
  { page: "desporto", category: "Desporto" },
  { page: "culture", category: "Cultura" },
];
const HEADLINE = /<h[1-4][^>]*>\s*<a href='(https:\/\/www\.lusa\.pt\/[^']+\/article\/\d{4}-\d{2}-\d{2}\/\d+\/[^']+)'[^>]*>([^<]{12,220})<\/a>[\s\S]{0,800}?<li>\s*(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2})\s*<\/li>/gi;
const IMAGE = /href='(https:\/\/www\.lusa\.pt\/[^']+\/article\/[^']+)'>\s*<img src='(https:\/\/www\.lusa\.pt\/temp\/images\/[^']+)'/gi;

function hashId(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return "n" + Math.abs(h).toString(36);
}

function canonical(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function decode(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/"/gi, "\"")
    .replace(/&#39;|'/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** A listagem só traz miniaturas. A Lusa publica a mesma foto em 780x1200. */
function largeLusaImage(src: string): string | null {
  const match = src.match(/\/temp\/images\/\d+x\d+\/cache_\d+x\d+_[A-Za-z]+_[A-Za-z]+_(\d+(?:_\d+)+)\.(jpe?g|png|webp)/i);
  if (!match) return null;
  const ext = match[2].toLowerCase() === "jpeg" ? "JPG" : match[2].toUpperCase();
  return `https://www.lusa.pt/TEMP/IMAGES/780x1200/CACHE_780X1200_ANALOG_WATERMARKED_${match[1]}.${ext}`;
}

function lisbonToIso(stamp: string): string | null {
  const match = stamp.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min] = match;
  const desired = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${min}:00Z`);
  let time = desired;
  for (let i = 0; i < 3; i++) {
    const shown = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(time)).replace(" ", "T");
    const delta = desired - Date.parse(`${shown}:00Z`);
    if (delta === 0) break;
    time += delta;
  }
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function imageFromArticle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "pt-PT,pt;q=0.9" },
      signal: AbortSignal.timeout(4000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 80_000);
    const og = html.match(/property=['"]og:image['"][^>]*content=['"]([^'"]+)['"]/i)?.[1]
      ?? html.match(/content=['"]([^'"]+)['"][^>]*property=['"]og:image['"]/i)?.[1];
    return og?.startsWith("https://") ? og : null;
  } catch {
    return null;
  }
}

export async function scrapeLusa(): Promise<NewsItem[]> {
  const pages = await Promise.all(PAGES.map(async ({ page, category }) => {
    try {
      const res = await fetch(`https://www.lusa.pt/${page}`, {
        headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "pt-PT,pt;q=0.9" },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      if (!res.ok) return [] as NewsItem[];
      const html = await res.text();
      const images = new Map<string, string>();
      for (const match of html.matchAll(IMAGE)) images.set(match[1], match[2]);
      const items: NewsItem[] = [];
      for (const match of html.matchAll(HEADLINE)) {
        const url = match[1];
        const title = decode(match[2]);
        const publishedAt = lisbonToIso(match[3]);
        if (!publishedAt || title.length < 15) continue;
        if (Date.now() - new Date(publishedAt).getTime() > 30 * 3600_000) continue;
        const thumb = images.get(url);
        const large = thumb ? largeLusaImage(thumb) : null;
        const imageCandidates = [...new Set([large, thumb].filter((value): value is string => Boolean(value)))];
        items.push({
          id: hashId(canonical(url)),
          source: "Lusa",
          category,
          title,
          excerpt: "",
          url,
          publishedAt,
          image: imageCandidates[0],
          imageCandidates,
        });
      }
      return items;
    } catch {
      return [] as NewsItem[];
    }
  }));
  const seen = new Set<string>();
  const picked = pages
    .flat()
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
    .filter((item) => {
      const key = canonical(item.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
  await Promise.all(itemsWithoutImage(picked));
  return picked;
}

function itemsWithoutImage(items: NewsItem[]): Promise<void>[] {
  return items.filter((item) => !item.image).slice(0, 8).map(async (item) => {
    const image = await imageFromArticle(item.url);
    if (!image) return;
    item.image = image;
    item.imageCandidates = [image];
  });
}
