/** ImageKit centraliza a entrega e as transformações das imagens externas. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

type ImageProfile = "feed" | "article";

/** Só a largura. A foto nítida fica por cima de um fundo desfocado. */
const TRANSFORMS: Record<ImageProfile, string> = {
  feed: "tr:w-1080,q-auto,f-auto,e-sharpen-15",
  article: "tr:w-1080,q-auto,f-auto,e-sharpen-15",
};

/** Fundo: cópia pequena já desfocada no ImageKit, para não pesar no telemóvel. */
const BACKDROP = "tr:w-720,bl-32,q-50,f-auto";

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

export function imageKitBackdropUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const mark = `${IMAGEKIT_ENDPOINT}/${TRANSFORMS.feed}/`;
  if (!url.startsWith(mark)) return null;
  return `${IMAGEKIT_ENDPOINT}/${BACKDROP}/${url.slice(mark.length)}`;
}
