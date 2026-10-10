import { adequateImage, type ImageDimensions } from "./image-quality";

// Read image headers only; never download/store entire originals or use file KB as quality.
export function dimensionsFromHeader(bytes: Uint8Array): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length >= 24 && text(1, 3) === "PNG") {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 10 && text(0, 3) === "GIF") {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    if (text(12, 4) === "VP8X") {
      const u24 = (i: number) => (bytes[i] ?? 0) + ((bytes[i + 1] ?? 0) << 8) + ((bytes[i + 2] ?? 0) << 16);
      return { width: u24(24) + 1, height: u24(27) + 1 };
    }
    if (text(12, 4) === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (text(12, 4) === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos] !== 0xff) break;
      while (bytes[pos] === 0xff) pos++;
      const marker = bytes[pos++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
      if (pos + 2 > bytes.length) break;
      const length = view.getUint16(pos);
      if (length < 2 || pos + length > bytes.length) break;
      if (marker !== undefined && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return { width: view.getUint16(pos + 5), height: view.getUint16(pos + 3) };
      }
      pos += length;
    }
  }
  return null;
}

export async function inspectImage(url: string): Promise<ImageDimensions | null> {
  try {
    if (!url.startsWith("https://")) return null;
    const response = await fetch(url, { headers: { Range: "bytes=0-65535" }, signal: AbortSignal.timeout(2500) });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const header = new Uint8Array(65_536);
    let length = 0;
    try {
      while (length < header.length) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const count = Math.min(chunk.value.length, header.length - length);
        header.set(chunk.value.subarray(0, count), length);
        length += count;
        const dimensions = dimensionsFromHeader(header.subarray(0, length));
        if (dimensions) return dimensions;
      }
      return null;
    } finally {
      await reader.cancel();
    }
  } catch {
    return null;
  }
}

export async function chooseOriginal(candidates: string[]): Promise<string | null> {
  let acceptable: string | null = null;
  for (const url of [...new Set(candidates)].slice(0, 4)) {
    const size = await inspectImage(url);
    if (!size || !adequateImage(size)) continue;
    if (size.width >= 1200) return url;
    acceptable ??= url;
  }
  return acceptable;
}