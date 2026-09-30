import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchArticle, type ArticleContent } from "./article.server";

export type { ArticleContent };

export const getArticle = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data }): Promise<ArticleContent> => {
    try {
      return await fetchArticle(data.url);
    } catch {
      return { paragraphs: [] };
    }
  });
