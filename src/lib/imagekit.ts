/** ImageKit permanente. Todas as fotos da app passam por aqui. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

/**
 * A ImageKit analisa a foto e centra na parte importante (fo-auto).
 * 1080x1350 é retrato, mas largo o suficiente para não ampliar demais.
 * Qualidade 85, formato automático. Fotos pequenas não são forçadas a 1620.
 */
const TRANSFORM = "tr:w-1080,h-1350,fo-auto,q-85,f-auto";

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
