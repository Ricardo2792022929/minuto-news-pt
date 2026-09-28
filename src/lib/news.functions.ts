import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAllNews } from "./news.server";

export const getNews = createServerFn({ method: "GET" })
  .inputValidator(
    (data) =>
      z
        .object({
          offset: z.number().min(0).default(0),
          limit: z.number().min(1).max(50).default(12),
          category: z.string().optional(),
        })
        .parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    const all = await getAllNews();
    const filtered = data.category
      ? all.filter((a) => a.category === data.category)
      : all;
    const items = filtered.slice(data.offset, data.offset + data.limit);
    return {
      items,
      total: filtered.length,
      hasMore: data.offset + data.limit < filtered.length,
    };
  });

export type GetNewsResult = Awaited<ReturnType<typeof getNews>>;
