export type ImageDimensions = { width: number; height: number };

// 1200px is a preference, not a requirement. Smaller usable photos remain valid.
export function adequateImage({ width, height }: ImageDimensions): boolean {
  return width >= 800 && height >= 600 && width * height >= 720_000;
}

export function excessiveEnlargement(size: ImageDimensions, width: number, height: number): boolean {
  return !adequateImage(size) || Math.max(width / size.width, height / size.height) > 1.6;
}