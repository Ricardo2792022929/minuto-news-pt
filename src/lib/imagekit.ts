/** ImageKit permanente. Todas as fotos da app passam por aqui. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

/** Retrato do cartão, assunto centrado, qualidade boa, formato automático. */
const TRANSFORM = "tr:w-1080,h-1620,fo-auto,q-80,f-auto,pr-true";

export function imageKitUrl(url: string | null | undefined): string | null {
  if (!url || url.startsWith("/") || url.startsWith("data:")) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname === "ik.imagekit.io") return null;
    return `${IMAGEKIT_ENDPOINT}/${TRANSFORM}/${url}`;
  } catch {
    return null;
  }
}
