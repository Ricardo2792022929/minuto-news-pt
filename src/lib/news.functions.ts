import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NewsItem } from "./news.types";
import { finalImageUrl, guaranteedImage } from "./image-policy";

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
    const cols = "id,source,category,url,image,titulo_inedito,resumo,published_at";
    const toItem = (r: {
      id: string;
      source: string;
      category: string;
      url: string;
      image: string | null;
      titulo_inedito: string;
      resumo: string | null;
      published_at: string;
    }): NewsItem => ({
      id: r.id,
      source: r.source,
      category: r.category,
      title: r.titulo_inedito,
      excerpt: (r.resumo ?? "").trim(),
      url: r.url,
      publishedAt: r.published_at,
      image: finalImageUrl(r.image, r.category, r.titulo_inedito, r.id) || guaranteedImage(r.id, r.category),
    });

    // Mais recentes primeiro. A atualização habitual não muda.
    let q = db
      .from("articles")
      .select(cols, { count: "exact" })
      .gte("published_at", new Date(now - 24 * 3600_000).toISOString())
      .order("published_at", { ascending: false })
      .order("id", { ascending: true })
      .range(0, Math.min(data.offset + data.limit + 60, 1000) - 1);
    if (data.category) q = q.eq("category", data.category);
    const { data: rows, error, count } = await q;
    if (error) {
      console.error(error);
      return { items: [], total: 0, hasMore: false, nextOffset: data.offset };
    }
    const total = count ?? 0;
    const ordered = (rows ?? []).map(toItem).sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    const fresh = ordered.slice(data.offset, data.offset + data.limit);

    // Notícias de há umas horas (cerca de 5, entre 2 e 12) que continuam relevantes.
    const olderSince = new Date(now - 12 * 3600_000).toISOString();
    const olderUntil = new Date(now - 2 * 3600_000).toISOString();
    const loadOlder = async (onlyInterests: boolean) => {
      let oq = db
        .from("articles")
        .select(cols)
        .gte("published_at", olderSince)
        .lte("published_at", olderUntil)
        .order("published_at", { ascending: false })
        .limit(40);
      if (data.category) oq = oq.eq("category", data.category);
      else if (onlyInterests && data.interests && data.interests.length) oq = oq.in("category", data.interests);
      const { data: olderRows } = await oq;
      return (olderRows ?? []).map(toItem);
    };
    let older = await loadOlder(true);
    if (older.length < 4 && !data.category) older = await loadOlder(false);
    const byCategory = new Map<string, NewsItem[]>();
    for (const item of older) {
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
    const pool = diversified.slice(page * 3);
    const seen = new Set(fresh.map((item) => item.id));
    const titleKey = (title: string) =>
      title.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/\s+/).slice(0, 6).join(" ");
    const freshTitles = new Set(fresh.map((item) => titleKey(item.title)));
    const mixed: NewsItem[] = [];
    let olderIndex = 0;
    fresh.forEach((item, index) => {
      mixed.push(item);
      if ((index + 1) % 3 !== 0) return;
      while (olderIndex < pool.length) {
        const candidate = pool[olderIndex];
        olderIndex += 1;
        if (!candidate || seen.has(candidate.id) || freshTitles.has(titleKey(candidate.title))) continue;
        seen.add(candidate.id);
        mixed.push(candidate);
        break;
      }
    });

    const nextOffset = data.offset + data.limit;
    return { items: mixed, total, hasMore: nextOffset < total, nextOffset };
  });

export type GetNewsResult = {
  items: NewsItem[];
  total: number;
  hasMore: boolean;
  nextOffset?: number;
};
