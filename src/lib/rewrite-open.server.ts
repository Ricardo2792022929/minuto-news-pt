import { generateOne, isPublishableTitle } from "./title-generation.server";
import { generateCloudflareOne } from "./title-generation.cloudflare.server";
import { isPastedTitle } from "./title-shape";

type Row = {
  id: string;
  original_title: string | null;
  titulo_inedito: string | null;
  resumo: string | null;
};

let coolingUntil = 0;

/** Reescreve títulos que ainda são o original cortado. No máximo 8, e não em cada scroll. */
export async function rewriteOpenedTitles(): Promise<number> {
  if (Date.now() < coolingUntil) return 0;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("articles")
    .select("id, original_title, titulo_inedito, resumo")
    .order("published_at", { ascending: false })
    .limit(36);
  const pending = ((data ?? []) as Row[])
    .filter((row) => row.original_title && row.titulo_inedito && isPastedTitle(row.titulo_inedito, row.original_title))
    .slice(0, 8);
  if (!pending.length) return 0;
  coolingUntil = Date.now() + 45_000;
  let saved = 0;
  await Promise.all(pending.map(async (row) => {
    const original = row.original_title ?? "";
    let next: { titulo: string; resumo: string } | null = null;
    try { next = await generateOne(original, row.resumo); } catch { next = null; }
    if (!next || !isPublishableTitle(next.titulo, original)) {
      try { next = await generateCloudflareOne(original, row.resumo); } catch { next = null; }
    }
    if (!next || !isPublishableTitle(next.titulo, original) || isPastedTitle(next.titulo, original)) return;
    const { error } = await supabaseAdmin
      .from("articles")
      .update({ titulo_inedito: next.titulo.slice(0, 180), resumo: (next.resumo || row.resumo || next.titulo).slice(0, 300) })
      .eq("id", row.id);
    if (!error) saved += 1;
  }));
  return saved;
}
