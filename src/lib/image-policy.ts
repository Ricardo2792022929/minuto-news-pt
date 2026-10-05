import photo0 from "@/assets/fallback-0.asset.json";
import photo1 from "@/assets/fallback-1.asset.json";
import photo2 from "@/assets/fallback-2.asset.json";
import photo3 from "@/assets/fallback-3.asset.json";
import photo4 from "@/assets/fallback-4.asset.json";
import photo5 from "@/assets/fallback-5.asset.json";
import photo6 from "@/assets/fallback-6.asset.json";

export const CATEGORY_PHOTOS: Record<string, string> = {
  "Crime": photo0.url,
  "Política": photo1.url,
  "Economia": photo2.url,
  "Desporto": photo3.url,
  "Mundo": photo4.url,
  "Cultura": photo5.url,
  "Tech": photo6.url,
};
const CRIME_RE = /\b(gnr|psp|pol[ií]cia|detid|crime|assalt|tiroteio|homic|preso|roubo)/i;
export function categoryImage(category?: string, title = ""): string {
  return CATEGORY_PHOTOS[CRIME_RE.test(title) ? "Crime" : category ?? "Mundo"] ?? photo4.url;
}

export function finalImageUrl(raw: string | null | undefined, category?: string, title = ""): string {
  if (raw?.startsWith("/__l5e/assets-v1/")) return raw;
  try {
    const url = new URL(raw?.trim() ?? "");
    if (url.protocol !== "https:") return categoryImage(category, title);
    if (/(^|\.)(images\.unsplash\.com|images\.pexels\.com|[^.]+\.imgix\.net)$/.test(url.hostname)) {
      url.searchParams.set("w", "800");
      url.searchParams.set("q", "80");
      url.searchParams.set("fit", "crop");
      url.searchParams.set("auto", "format");
    }
    return url.toString();
  } catch {
    return categoryImage(category, title);
  }
}
