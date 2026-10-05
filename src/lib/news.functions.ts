import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NewsItem } from "./news.types";

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

    let q = db
      .from("articles")
      .select("id,source,category,url,image,titulo_inedito,relevance,published_at")
      .gte("published_at", new Date(Date.now() - 72 * 3600_000).toISOString())
      .order("relevance", { ascending: false })
      .limit(600);
    if (data.category) q = q.eq("category", data.category);
    const { data: rows, error } = await q;
    if (error) {
      console.error(error);
      return { items: [], total: 0, hasMore: false };
    }

    const interests = data.interests ?? [];
    const BONUS = 4 * 3600_000;
    const sorted = [...(rows ?? [])].sort(
      (a, b) =>
        b.relevance + (interests.includes(b.category) ? BONUS : 0) -
        (a.relevance + (interests.includes(a.category) ? BONUS : 0)),
    );
    const items: NewsItem[] = sorted.slice(data.offset, data.offset + data.limit).map((r) => ({
      id: r.id,
      source: r.source,
      category: r.category,
      title: r.titulo_inedito,
      excerpt: "",
      url: r.url,
      publishedAt: r.published_at,
      ...(r.image ? { image: r.image } : {}),
    }));
    return { items, total: sorted.length, hasMore: data.offset + data.limit < sorted.length };
  });

export type GetNewsResult = {
  items: NewsItem[];
  total: number;
  hasMore: boolean;
};
