import { getAllNews, relevanceScore } from "./news.server";
import { generateTitles, GatewayError } from "./title-generation.server";

const BATCH = 20; // títulos por chamada de IA
const MAX_BATCHES = 3; // limite por execução

type Hit = { url: string; width?: number };
const pickRandom = (arr: Hit[], used: Set<string>) => {
  const ok = arr.filter((r) => (r.width ?? 0) >= 1000 && /^https:\/\//.test(r.url) && !used.has(r.url));
  const pick = ok[Math.floor(Math.random() * ok.length)]?.url ?? null;
  if (pick) used.add(pick);
  return pick;
};

// Unsplash (fotografias reais) — só se existir chave.
async function fromUnsplash(term: string, used: Set<string>) {
  const key = process.env["UNSPLASH_ACCESS_KEY"];
  if (!key) return null;
  const page = 1 + Math.floor(Math.random() * 3);
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(term)}&orientation=portrait&per_page=20&page=${page}&content_filter=high`,
    { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { results?: { width: number; urls: { raw: string } }[] };
  return pickRandom((d.results ?? []).map((r) => ({ url: `${r.urls.raw}&w=800&q=80&fit=crop`, width: r.width })), used);
}

// Pexels (fotografias reais) — só se existir chave.
async function fromPexels(term: string, used: Set<string>) {
  const key = process.env["PEXELS_API_KEY"];
  if (!key) return null;
  const page = 1 + Math.floor(Math.random() * 3);
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(term)}&orientation=portrait&per_page=20&page=${page}`,
    { headers: { Authorization: key }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { photos?: { width: number; src: { large2x: string } }[] };
  return pickRandom((d.photos ?? []).map((p) => ({ url: p.src.large2x, width: p.width })), used);
}

// Openverse / Wikimedia Commons (fotografias reais, sem conta). Página aleatória
// + escolha aleatória para notícias do mesmo tema receberem fotos diferentes.
async function fromOpenverse(term: string, used: Set<string>) {
  const page = 1 + Math.floor(Math.random() * 3);
  const res = await fetch(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&size=large&category=photograph&page_size=20&page=${page}&mature=false`,
    { headers: { "User-Agent": "AoMinuto/1.0" }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { results?: Hit[] };
  return pickRandom(d.results ?? [], used);
}

async function findHdImage(term: string, used: Set<string>): Promise<string | null> {
  if (!term) return null;
  for (const fn of [fromUnsplash, fromPexels, fromOpenverse]) {
    try {
      const img = await fn(term, used);
      if (img) return img;
    } catch {
      /* tenta a fonte seguinte */
    }
  }
  return null;
}

const CATEGORY_EN: Record<string, string> = {
  Política: "parliament building", Economia: "euro banknotes coins", Desporto: "football stadium",
  Mundo: "city skyline", Cultura: "concert crowd", Tech: "laptop computer",
};

async function findHdImageAny(term: string, category: string, used: Set<string>) {
  const words = term.split(/\s+/).filter(Boolean);
  const tries = [term, words.slice(-1)[0] ?? "", CATEGORY_EN[category] ?? "news"];
  for (const t of tries) {
    const img = await findHdImage(t, used);
    if (img) return img;
  }
  return null;
}

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

    // evita repetir a mesma foto de reserva
    const { data: recent } = await db.from("articles").select("image").not("image_query", "is", null).limit(500);
    const used = new Set((recent ?? []).map((r) => r.image).filter(Boolean) as string[]);

    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      const gen = await generateTitles(chunk);
      const rows = [];
      for (const n of chunk) {
        const g = gen.get(n.id);
        if (!g) continue;
        let image = n.image ?? null;
        let image_query: string | null = null;
        if (!image) {
          image_query = g.termo;
          image = await findHdImageAny(g.termo, n.category, used);
        }
        rows.push({
          id: n.id,
          source: n.source,
          category: n.category,
          url: n.url,
          image,
          image_query,
          original_title: n.title,
          titulo_inedito: g.titulo,
          relevance: Math.round(relevanceScore(n)),
          published_at: n.publishedAt,
        });
      }
      if (rows.length) {
        const { error } = await db.from("articles").upsert(rows, { onConflict: "id" });
        if (error) throw error;
        inserted += rows.length;
      }
    }

    // reprocessa notícias que ficaram sem foto (limitado)
    const { data: missing } = await db.from("articles").select("id,image_query,category").is("image", null).limit(20);
    for (const m of missing ?? []) {
      const img = await findHdImageAny(m.image_query ?? "", m.category, used);
      if (img) await db.from("articles").update({ image: img }).eq("id", m.id);
    }

    // histórico mantido: nunca apagamos notícias antigas
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
