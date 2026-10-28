/** ImageKit centraliza a entrega e as transformações das imagens externas. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

type ImageProfile = "feed" | "article";

/** Vertical do ecrã, centrado na cara, afastado o suficiente para a cabeça não ser cortada. */
const TRANSFORMS: Record<ImageProfile, string> = {
  feed: "tr:w-1080,ar-9-16,fo-face,z-0.75,q-auto,f-auto,e-sharpen-15",
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
