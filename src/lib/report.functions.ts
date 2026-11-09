import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const REPORT_REASONS = ["image", "title", "duplicate", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

type LooseInsert = { from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> } };

/** Guarda um "reportar problema" de um leitor na tabela article_reports (ver no painel do Supabase). */
export const reportArticle = createServerFn({ method: "POST" })
  .validator((data) =>
    z
      .object({
        articleId: z.string().min(1).max(200),
        reason: z.enum(REPORT_REASONS),
        title: z.string().max(400).optional(),
        source: z.string().max(120).optional(),
        category: z.string().max(60).optional(),
        image: z.string().max(2000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as unknown as LooseInsert;
      const { error } = await db.from("article_reports").insert({
        article_id: data.articleId,
        reason: data.reason,
        title: data.title ?? null,
        source: data.source ?? null,
        category: data.category ?? null,
        image: data.image ?? null,
      });
      if (error) {
        console.error("article_report_failed", error.message);
        return { ok: false };
      }
      return { ok: true };
    } catch (error) {
      console.error("article_report_failed", error instanceof Error ? error.message : String(error));
      return { ok: false };
    }
  });
