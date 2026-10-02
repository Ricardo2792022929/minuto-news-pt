import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  generateNewsPublication,
  type GeneratedPublication,
} from "./news-generation.server";

const cache = new Map<string, { publication: GeneratedPublication; at: number }>();
const TTL = 60 * 60_000;

export const summarizeArticle = createServerFn({ method: "POST" })
  .validator((data) =>
    z
      .object({
        id: z.string(),
        originalTitle: z.string().min(1),
        text: z.string().min(1),
        source: z.string().min(1),
        imageUrl: z.string().url().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<GeneratedPublication> => {
    const hit = cache.get(data.id);
    if (hit && Date.now() - hit.at < TTL) return hit.publication;

    const publication = await generateNewsPublication({
      originalTitle: data.originalTitle,
      text: data.text,
      source: data.source,
      imageUrl: data.imageUrl,
    });
    cache.set(data.id, { publication, at: Date.now() });
    return publication;
  });
