import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAllNews } from "./news.server";

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
  .handler(async ({ data }) => {
    const all = await getAllNews();
    let filtered = data.category
      ? all.filter((a) => a.category === data.category)
      : all;

    // Notícias variadas mas centradas nos gostos: categorias preferidas
    // recebem um "empurrão" de 6 horas, mantendo a ordem cronológica.
    const interests = data.interests ?? [];
    if (interests.length) {
      const BONUS = 4 * 3600_000;
      const score = (a: (typeof filtered)[number]) =>
        relevanceScore(a) + (interests.includes(a.category) ? BONUS : 0);
      filtered = [...filtered].sort((a, b) => score(b) - score(a));
    }

    const items = filtered.slice(data.offset, data.offset + data.limit);
    return {
      items,
      total: filtered.length,
      hasMore: data.offset + data.limit < filtered.length,
    };
  });

export type GetNewsResult = {
  items: import("./news.types").NewsItem[];
  total: number;
  hasMore: boolean;
};
