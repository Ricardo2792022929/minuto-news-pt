export type StoryLink = {
  source: string;
  title: string;
  url: string;
  publishedAt: string;
};

export function plainTitle(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(title: string): Set<string> {
  return new Set(plainTitle(title).split(" ").filter((word) => word.length > 3));
}

export function titlesMatch(left: string, right: string): boolean {
  const a = plainTitle(left);
  const b = plainTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared++;
  if (shared < 3) return false;
  return shared / (leftTokens.size + rightTokens.size - shared) >= 0.62;
}

export function sameStory(
  left: { title: string; originalTitle?: string; category: string; publishedAt: string; source: string },
  right: { title: string; originalTitle?: string; category: string; publishedAt: string; source: string },
): boolean {
  if (left.source === right.source) return false;
  const hours = Math.abs(+new Date(left.publishedAt) - +new Date(right.publishedAt)) / 3_600_000;
  if (!Number.isFinite(hours) || hours > 12) return false;
  if (left.category !== right.category && left.category !== "Mundo" && right.category !== "Mundo") return false;
  const leftTitles = [left.title, left.originalTitle].filter((title): title is string => Boolean(title));
  const rightTitles = [right.title, right.originalTitle].filter((title): title is string => Boolean(title));
  return leftTitles.some((title) => rightTitles.some((other) => titlesMatch(title, other)));
}

export function mergeLinks(current: StoryLink[], extra: StoryLink[]): StoryLink[] {
  const out: StoryLink[] = [];
  for (const link of [...current, ...extra]) {
    if (!link.url || !link.source) continue;
    if (out.some((item) => item.url === link.url || item.source === link.source)) continue;
    out.push({
      source: link.source.slice(0, 120),
      title: link.title.slice(0, 180),
      url: link.url.slice(0, 2000),
      publishedAt: link.publishedAt,
    });
    if (out.length === 6) break;
  }
  return out;
}

export function asLinks(value: unknown): StoryLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.source !== "string" || typeof row.url !== "string" || typeof row.title !== "string") return [];
    return [{
      source: row.source,
      title: row.title,
      url: row.url,
      publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : new Date(0).toISOString(),
    }];
  });
}
