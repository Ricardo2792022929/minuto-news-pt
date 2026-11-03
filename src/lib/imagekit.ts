/** ImageKit centraliza a entrega e as transformações das imagens externas. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

type ImageProfile = "feed" | "article";

/** Vertical do ecrã. `fo-auto` centra o corte no assunto principal da foto (cara, objeto ou zona de maior interesse). O `z` só existe com `fo-face`/`fo-<objeto>`, por isso saiu. */
const TRANSFORMS: Record<ImageProfile, string> = {
  feed: "tr:w-1080,ar-9-16,fo-auto,q-auto,f-auto,e-sharpen-15",
  article: "tr:w-1080,q-auto,f-auto,e-sharpen-15",
};

export function imageKitUrl(url: string | null | undefined, profile: ImageProfile = "feed"): string | null {
  if (!url || url.startsWith("/") || url.startsWith("data:")) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname === "ik.imagekit.io") return null;
    return `${IMAGEKIT_ENDPOINT}/${TRANSFORMS[profile]}/${url}`;
  } catch {
    return null;
  }
}
