export type ImageDimensions = { width: number; height: number };

// A foto da notícia vale mais do que uma imagem genérica do tema.
// Só se rejeita uma miniatura a sério, não uma foto normal de artigo.
export function adequateImage({ width, height }: ImageDimensions): boolean {
  return width >= 640 && height >= 360;
}

export function excessiveEnlargement(size: ImageDimensions, width: number, height: number): boolean {
  if (!size.width || !size.height) return false;
  if (size.width < 480 || size.height < 270) return true;
  return Math.max(width / size.width, height / size.height) > 2.5;
}
