import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NewsItem } from "./news.types";
import { finalImageUrl } from "./image-policy";
import { articleMatchesClub } from "./clubs";
import { classify } from "./news.server";
import { isPublishableTitle } from "./title-generation.server";

const SHOCK = [
  "morre", "morreu", "morto", "mortos", "mata", "matou", "assassin", "vitima", "tragedia",
  "ataque", "guerra", "bomba", "explos", "tiroteio", "missile", "missil",
  "detid", "preso", "prisao", "crime", "assalt", "roubo", "homicid", "rapto",
  "incendio", "sismo", "terramoto", "inund", "tempestade", "catastrof", "acidente", "despiste",
  "escandalo", "corrup", "fraude", "burla", "choque", "alerta", "urgente", "caos", "crise", "colaps",
  "demite", "demissao", "golpe", "ameaca", "sancao", "sancoes",
  "ucrania", "gaza", "israel", "putin", "trump", "zelensky", "irao", "russia",
  "greve", "desab", "explod", "queda de",
];
const SOFT = ["benfica", "sporting", "ronaldo", "golo", "derrota", "lesao", "champions"];
const DULL = [
  "horoscopo", "receita", "concerto", "exposicao", "orquestra", "inaugur", "freguesia",
  "ecopista", "passatempo", "publicidade", "podcast", "review", "beneficiacao",
  "agenda", "festival", "teatro", "livro",
];

function plain(title: string): string {
  return title.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function hit(text: string, word: string): boolean {
  if (word.length >= 6) return text.includes(word);
  return new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(text);
}

/** Só entra no meio do feed se for relevante e um pouco chocante. */
function shockScore(title: string): number {
  const t = plain(title);
  let score = 0;
  for (const word of SHOCK) if (hit(t, word)) score += 3;
  for (const word of SOFT) if (hit(t, word)) score += 1;
  for (const word of DULL) if (t.includes(word)) score -= 6;
  return score;
}

// Lê apenas notícias já pré-processadas (com título final pronto) da base de dados.
export const getNews = createServerFn({ method: "GET" })
  .validator(
    (data) =>
      z
        .object({
          offset: z.number().min(0).default(0),
          limit: z.number().min(1).max(50).default(12),
          category: z.string().optional(),
          interests: z.array(z.string()).optional(),
          club: z.string().optional(),
        })
        .parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<GetNewsResult> => {
    const url = process.env["SUPABASE_URL"]!;
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const db = createClient(url, key, {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });

    const now = Date.now();
    const since = new Date(now - 24 * 3600_000).toISOString();
    const interests = (data.interests ?? []).filter(Boolean);
    const useInterests = !data.category && interests.length > 0;
    const cols = "id,source,category,url,image,image_query,image_status,image_candidates,titulo_inedito,resumo,original_title,published_at";
    const canShow = (r: { titulo_inedito: string | null; original_title: string | null }) =>
      isPublishableTitle(r.titulo_inedito, r.original_title);
    const fixes: { id: string; category: string }[] = [];
    const toItem = (r: {
      id: string;
      source: string;
      category: string;
      url: string;
      image: string | null;
      titulo_inedito: string;
      resumo: string | null;
      original_title: string | null;
      published_at: string;
    }): NewsItem => {
      const excerpt = (r.resumo ?? "").trim();
      const category = classify(`${r.original_title ?? ""} ${r.titulo_inedito} ${excerpt}`, r.category);
      if (category !== r.category) fixes.push({ id: r.id, category });
      return {
        id: r.id,
        source: r.source,
        category,
        title: r.titulo_inedito,
        excerpt,
        url: r.url,
        publishedAt: r.published_at,
        image: r.image_query || r.image_status === "provisional" ? undefined : finalImageUrl(r.image, category, r.titulo_inedito, r.id) || undefined,\n        imageStatus: r.image_query ? "provisional" : (r.image_status ?? "original"),\n        imageCandidates: Array.isArray(r.image_candidates) ? r.image_candidates.filter((candidate): candidate is string => typeof candidate === "string") : [],
      };
    };
    const byDate = (a: NewsItem, b: NewsItem) => +new Date(b.publishedAt) - +new Date(a.publishedAt);
    const roundRobin = (items: NewsItem[]) => {
      const buckets = new Map<string, NewsItem[]>();
      for (const item of [...items].sort(byDate)) {
        const list = buckets.get(item.category) ?? [];
        list.push(item);
        buckets.set(item.category, list);
      }
      const out: NewsItem[] = [];
      const lists = [...buckets.values()];
      let pending = true;
      while (pending) {
        pending = false;
        for (const list of lists) {
          const next = list.shift();
          if (next) {
            out.push(next);
            pending = true;
          }
        }
      }
      return out;
    };

    let total = 0;
    let ordered: NewsItem[] = [];
    if (useInterests) {
      const need = Math.min(data.offset + data.limit + 40, 400);
      const [insideRes, broadRes] = await Promise.all([
        db
          .from("articles")
          .select(cols, { count: "exact" })
          .gte("published_at", since)
          .in("category", interests)
          .order("published_at", { ascending: false })
          .range(0, need - 1),
        db
          .from("articles")
          .select(cols)
          .gte("published_at", since)
          .order("published_at", { ascending: false })
          .range(0, Math.min(need, 120) - 1),
      ]);
      if (insideRes.error) {
        console.error(insideRes.error);
        return { items: [], total: 0, hasMore: false, nextOffset: data.offset };
      }
      total = insideRes.count ?? 0;
      const mine = roundRobin((insideRes.data ?? []).filter(canShow).map(toItem));
      const other = (broadRes.data ?? [])
        .filter(canShow)
        .map(toItem)
        .filter((item) => !interests.includes(item.category))
        .sort(byDate);
      let mineIndex = 0;
      let otherIndex = 0;
      while (mineIndex < mine.length || otherIndex < other.length) {
        for (let step = 0; step < 3 && mineIndex < mine.length; step += 1) ordered.push(mine[mineIndex++]);
        if (otherIndex < other.length) ordered.push(other[otherIndex++]);
        if (mineIndex >= mine.length && otherIndex >= other.length) break;
      }
    } else {
      let q = db
        .from("articles")
        .select(cols, { count: "exact" })
        .gte("published_at", since)
        .order("published_at", { ascending: false })
        .order("id", { ascending: true })
        .range(0, Math.min(data.offset + data.limit + 60, 1000) - 1);
      if (data.category) q = q.eq("category", data.category);
      const { data: rows, error, count } = await q;
      if (error) {
        console.error(error);
        return { items: [], total: 0, hasMore: false, nextOffset: data.offset };
      }
      total = count ?? 0;
      ordered = (rows ?? []).filter(canShow).map(toItem).sort(byDate);
    }

    if (data.category) ordered = ordered.filter((item) => item.category === data.category);

    if (data.club) {
      const held: NewsItem[] = [];
      const spaced: NewsItem[] = [];
      let streak = 0;
      for (const item of ordered) {
        const isClub = articleMatchesClub(item.title, item.category, data.club);
        if (isClub && streak >= 1) {
          held.push(item);
          continue;
        }
        streak = isClub ? 1 : 0;
        spaced.push(item);
      }
      ordered = spaced.concat(held);
    }
    const fresh = ordered.slice(data.offset, data.offset + data.limit);

    // Do dia, até 24 horas, mas só as fortes. O fio das mais recentes não pára.
    const daySince = new Date(now - 24 * 3600_000).toISOString();
    const dayUntil = new Date(now - 90 * 60_000).toISOString();
    const loadDay = async (onlyInterests: boolean) => {
      let oq = db
        .from("articles")
        .select(cols)
        .gte("published_at", daySince)
        .lte("published_at", dayUntil)
        .order("published_at", { ascending: false })
        .limit(80);
      if (data.category) oq = oq.eq("category", data.category);
      else if (onlyInterests && data.interests && data.interests.length) oq = oq.in("category", data.interests);
      const { data: dayRows } = await oq;
      return (dayRows ?? []).filter(canShow).map(toItem).filter((item) => shockScore(item.title) >= 3);
    };
    let day = await loadDay(true);
    if (day.length < 4 && !data.category) day = await loadDay(false);
    day.sort((a, b) => shockScore(b.title) - shockScore(a.title) || +new Date(b.publishedAt) - +new Date(a.publishedAt));
    const byCategory = new Map<string, NewsItem[]>();
    for (const item of day) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }
    const diversified: NewsItem[] = [];
    const buckets = [...byCategory.values()];
    let pending = true;
    while (pending) {
      pending = false;
      for (const bucket of buckets) {
        const next = bucket.shift();
        if (next) {
          diversified.push(next);
          pending = true;
        }
      }
    }
    const page = Math.floor(data.offset / data.limit);
    const pool = diversified.slice(page * 4);
    const allowClub = Boolean(data.club) && (!data.category || data.category === "Desporto");
    let clubNews: NewsItem[] = [];
    if (allowClub && data.club) {
      const { data: clubRows } = await db
        .from("articles")
        .select(cols)
        .gte("published_at", daySince)
        .eq("category", "Desporto")
        .order("published_at", { ascending: false })
        .limit(80);
      clubNews = (clubRows ?? [])
        .map(toItem)
        .filter((item) => articleMatchesClub(item.title, item.category, data.club!))
        .sort((a, b) => shockScore(b.title) - shockScore(a.title) || +new Date(b.publishedAt) - +new Date(a.publishedAt));
    }
    const seen = new Set(fresh.map((item) => item.id));
    const titleKey = (title: string) => plain(title).split(/\s+/).slice(0, 6).join(" ");
    const freshTitles = new Set(fresh.map((item) => titleKey(item.title)));
    const mixed: NewsItem[] = [];
    let dayIndex = 0;
    fresh.forEach((item, index) => {
      mixed.push(item);
      // Três notícias dos gostos, depois uma forte do dia. O clube não entra aqui.
      if ((index + 1) % 3 !== 0) return;
      while (dayIndex < pool.length) {
        const candidate = pool[dayIndex];
        dayIndex += 1;
        if (!candidate || seen.has(candidate.id) || freshTitles.has(titleKey(candidate.title))) continue;
        if (data.club && articleMatchesClub(candidate.title, candidate.category, data.club)) continue;
        seen.add(candidate.id);
        mixed.push(candidate);
        break;
      }
    });
    if (clubNews.length > 0) {
      const clubPick = clubNews
        .slice(page)
        .find((item) => !seen.has(item.id) && !freshTitles.has(titleKey(item.title)));
      if (clubPick) {
        const at = Math.min(5, mixed.length);
        mixed.splice(at, 0, clubPick);
      }
    }

    const nextOffset = data.offset + data.limit;
    const pendingFixes = [...new Map(fixes.map((fix) => [fix.id, fix])).values()].slice(0, 25);
    if (pendingFixes.length) {
      await Promise.all(
        pendingFixes.map((fix) => db.from("articles").update({ category: fix.category }).eq("id", fix.id)),
      );
    }
    return { items: mixed, total, hasMore: nextOffset < total, nextOffset };
  });

export type GetNewsResult = {
  items: NewsItem[];
  total: number;
  hasMore: boolean;
  nextOffset?: number;
};
