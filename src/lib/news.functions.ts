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

    // Mais recentes primeiro, paginado na base de dados.
    let q = db
      .from("articles")
      .select("id,source,category,url,image,titulo_inedito,published_at", { count: "exact" })
      .order("published_at", { ascending: false })
      .order("id", { ascending: true })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.category) q = q.eq("category", data.category);
    const { data: rows, error, count } = await q;
    if (error) {
      console.error(error);
      return { items: [], total: 0, hasMore: false };
    }
    const total = count ?? 0;
    const items: NewsItem[] = (rows ?? []).map((r) => ({
      id: r.id,
      source: r.source,
      category: r.category,
      title: r.titulo_inedito,
      excerpt: "",
      url: r.url,
      publishedAt: r.published_at,
      ...(r.image ? { image: r.image } : {}),
    }));
    return { items: spread(items), total, hasMore: data.offset + data.limit < total };
  });

export type GetNewsResult = {
  items: NewsItem[];
  total: number;
  hasMore: boolean;
};

// Reordena a página para evitar notícias seguidas da mesma fonte.
function spread(items: NewsItem[]): NewsItem[] {
  const rest = [...items];
  const out: NewsItem[] = [];
  while (rest.length) {
    const prev = out[out.length - 1]?.source;
    const i = rest.findIndex((x) => x.source !== prev);
    out.push(rest.splice(i < 0 ? 0 : i, 1)[0]!);
  }
  return out;
}
