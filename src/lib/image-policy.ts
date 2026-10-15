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

/** Imagem ilustrativa local por categoria; não apresenta uma fotografia aleatória como se fosse da notícia. */
export function guaranteedImage(_id: string, category?: string): string {
  return CATEGORY_PHOTOS[category ?? "Mundo"] ?? photo4.url;
}

export function categoryImage(category?: string, title = "", id = ""): string {
  // Prefer local Lovable asset if available, otherwise guaranteed Picsum
  const local = CATEGORY_PHOTOS[CRIME_RE.test(title) ? "Crime" : category ?? "Mundo"] ?? photo4.url;
  if (local && local.startsWith("/")) return local;
  return guaranteedImage(id || category || "cat", category);
}

/** URL da própria notícia. Nunca devolve foto de categoria, stock ou Picsum. */
export function storyImageUrl(raw: string | null | undefined): string | null {
  if (!raw || Object.values(CATEGORY_PHOTOS).includes(raw) || raw.startsWith("/") || raw.startsWith("data:")) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    if (url.hostname === "picsum.photos" || url.hostname.endsWith(".picsum.photos")) return null;
    if (/logo|placeholder|default|blank|pixel|1x1|spacer/i.test(url.pathname + url.search)) return null;
    if (url.hostname === "images.unsplash.com" || url.hostname === "images.pexels.com" || url.hostname.endsWith(".imgix.net")) {
      url.searchParams.set("w", "1200");
      url.searchParams.set("q", "80");
      url.searchParams.set("fit", "crop");
      url.searchParams.set("auto", "format");
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function finalImageUrl(raw: string | null | undefined, category?: string, title = "", id = ""): string {
  if (raw?.startsWith("/__l5e/assets-v1/")) return raw;
  try {
    const url = new URL(raw?.trim() ?? "");
    if (url.protocol !== "https:") return guaranteedImage(id, category);
    // Reject known broken or low-quality patterns
    if (/logo|placeholder|default|blank|pixel|1x1|spacer/i.test(url.pathname + url.search)) {
      return guaranteedImage(id, category);
    }
    if (url.hostname === "images.unsplash.com" || url.hostname === "images.pexels.com" || url.hostname.endsWith(".imgix.net")) {
      url.searchParams.set("w", "1200");
      url.searchParams.set("q", "80");
      url.searchParams.set("fit", "crop");
      url.searchParams.set("auto", "format");
    }
    return url.toString();
  } catch {
    return guaranteedImage(id, category);
  }
}
