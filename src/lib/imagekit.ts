/** ImageKit permanente. Todas as fotos da app passam por aqui. */
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/1aur3rser";

/**
 * Não corta nem amplia.
 * w-1200 limita o tamanho no telemóvel.
 * c-at_max mantém a foto inteira e não aumenta imagens pequenas (evita pixelização).
 * O cartão corta só o que for preciso com object-cover.
 */
const TRANSFORM = "tr:w-1200,c-at_max,q-85,f-auto";

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
