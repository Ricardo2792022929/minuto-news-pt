import { getAllNews, relevanceScore } from "./news.server";
import { generateTitles, GatewayError } from "./title-generation.server";

const BATCH = 20; // títulos por chamada de IA
const MAX_BATCHES = 3; // limite por execução

export async function runIngest(): Promise<Record<string, unknown>> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

  const { data: state } = await db.from("ingest_state").select("paused_reason").eq("id", 1).single();
  if (state?.paused_reason) return { skipped: "paused", reason: state.paused_reason };

  const nowIso = new Date().toISOString();
  const { data: lock } = await db
    .from("ingest_state")
    .update({ locked_until: new Date(Date.now() + 4 * 60_000).toISOString(), updated_at: nowIso })
    .eq("id", 1)
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
    .select("id");
  if (!lock?.length) return { skipped: "locked" };

  let inserted = 0;
  try {
    const news = await getAllNews(); // já ordenado por relevância
    const ids = news.map((n) => n.id);
    const existing = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("articles").select("id").in("id", ids.slice(i, i + 200));
      for (const r of data ?? []) existing.add(r.id);
    }
    const pending = news.filter((n) => !existing.has(n.id)).slice(0, BATCH * MAX_BATCHES);

    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      const titles = await generateTitles(chunk);
      const rows = chunk
        .filter((n) => titles.has(n.id))
        .map((n) => ({
          id: n.id,
          source: n.source,
          category: n.category,
          url: n.url,
          image: n.image ?? null,
          original_title: n.title,
          titulo_inedito: titles.get(n.id)!,
          relevance: Math.round(relevanceScore(n)),
          published_at: n.publishedAt,
        }));
      if (rows.length) {
        const { error } = await db.from("articles").upsert(rows, { onConflict: "id" });
        if (error) throw error;
        inserted += rows.length;
      }
    }

    // limpeza: mais de 4 dias
    await db.from("articles").delete().lt("published_at", new Date(Date.now() - 96 * 3600_000).toISOString());
    return { inserted, pending: pending.length };
  } catch (e) {
    if (e instanceof GatewayError && (e.status === 402 || e.status === 403)) {
      await db.from("ingest_state").update({ paused_reason: `${e.status}: ${e.message}` }).eq("id", 1);
    }
    console.error("ingest error", e);
    return { inserted, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await db.from("ingest_state").update({ locked_until: null }).eq("id", 1);
  }
}
