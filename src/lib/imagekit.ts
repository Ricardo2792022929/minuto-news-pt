/** ImageKit centraliza a entrega e as transformações das imagens externas. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

type ImageProfile = "feed" | "article";

/** Perfis próprios: cartões horizontais no feed e imagens maiores no artigo. */
const TRANSFORMS: Record<ImageProfile, string> = {
  feed: "tr:w-1080,h-1620,fo-face,cm-extract,q-auto,f-auto,e-sharpen-60,e-brightness-5",
  article: "tr:w-1200,h-1600,fo-face,cm-extract,q-auto,f-auto,e-sharpen-60,e-brightness-5",
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
