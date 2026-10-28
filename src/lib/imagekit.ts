/** ImageKit centraliza a entrega e as transformações das imagens externas. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

type ImageProfile = "feed" | "article";

/** Só a largura. O ecrã mostra a foto inteira; o fundo desfocado é que enche o resto. */
const TRANSFORMS: Record<ImageProfile, string> = {
  feed: "tr:w-1080,q-auto,f-auto,e-sharpen-15",
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
