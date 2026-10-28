/** ImageKit centraliza a entrega e as transformações das imagens externas. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

type ImageProfile = "feed" | "article";

/** 3:2 com a cara (ou as caras) no centro, sem apertar até cortar a cabeça. */
const TRANSFORMS: Record<ImageProfile, string> = {
  feed: "tr:w-1200,ar-3-2,fo-face,z-0.65,q-auto,f-auto,e-sharpen-15",
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
