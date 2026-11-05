/** ImageKit centraliza a entrega e as transformações das imagens externas. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

type ImageProfile = "feed" | "backdrop" | "article";

/**
 * feed: corte ligeiro em 4:5 (em vez de 9:16), centrado no assunto principal com `fo-auto`. Perde-se muito menos da foto.
 * backdrop: a mesma foto, pequena e desfocada, para preencher o resto do ecrã vertical por trás.
 */
const TRANSFORMS: Record<ImageProfile, string> = {
  feed: "tr:w-1080,ar-4-5,fo-auto,q-auto,f-auto,e-sharpen-15",
  backdrop: "tr:w-270,ar-9-16,fo-auto,bl-20,q-40,f-auto",
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
