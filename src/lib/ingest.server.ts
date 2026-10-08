import { getAllNews, relevanceScore, isLowResImage } from "./news.server";
import { generateTitles, GatewayError } from "./title-generation.server";
import { finalImageUrl } from "./image-policy";

const BATCH = 3; // lote de teste: apenas as 3 notícias mais recentes
const MAX_BATCHES = 1; // limite por execução

type Hit = { url: string; width?: number; text?: string | undefined };
const MAP_RE = /\b(map|maps|mapa|atlas|globe)\b/i;
const pickRandom = (arr: Hit[], used: Set<string>) => {
  const ok = arr.filter((r) => (r.width ?? 0) >= 1000 && !MAP_RE.test(`${r.text ?? ""} ${r.url}`) && /^https:\/\//.test(r.url) && !used.has(r.url));
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
  const d = (await res.json()) as { results?: { width: number; alt_description?: string; description?: string; urls: { raw: string } }[] };
  return pickRandom((d.results ?? []).map((r) => ({ url: `${r.urls.raw}&w=800&q=80&fit=crop`, width: r.width, text: `${r.alt_description ?? ""} ${r.description ?? ""}` })), used);
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
  const d = (await res.json()) as { photos?: { width: number; alt?: string; src: { large2x: string } }[] };
  return pickRandom((d.photos ?? []).map((p) => ({ url: p.src.large2x, width: p.width, text: p.alt })), used);
}

// Openverse / Wikimedia Commons (fotografias reais, sem conta). Página aleatória
// + escolha aleatória para notícias do mesmo tema receberem fotos diferentes.
async function fromOpenverse(term: string, used: Set<string>) {
  const page = 1 + Math.floor(Math.random() * 3);
  const res = await fetch(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&size=large&category=photograph&page_size=20&page=${page}&mature=false`,
    { headers: { "User-Agent": "FlashNoticias/1.0" }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { results?: (Hit & { title?: string })[] };
  return pickRandom((d.results ?? []).map((r) => ({ ...r, text: r.title })), used);
}

// Foto original do artigo: lê og:image / twitter:image da página da notícia.
async function fromArticlePage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FlashNoticiasFeed/1.0)", "Accept-Language": "pt-PT" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000);
    const m =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    const img = m?.[1]?.replace(/&amp;/g, "&").trim();
    if (!img) return null;
    const abs = new URL(img, url).toString().replace(/^http:/, "https:");
    if (isLowResImage(abs) || /logo|default|placeholder|\.svg/i.test(abs)) return null;
    return abs;
  } catch {
    return null;
  }
}

// Wikipedia: foto oficial de figuras públicas / entidades.
async function fromWikipedia(entity: string): Promise<string | null> {
  if (!entity) return null;
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity.trim().replace(/\s+/g, "_"))}?redirect=true`,
      { headers: { "User-Agent": "FlashNoticias/1.0 (news app)" }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      type?: string;
      originalimage?: { source: string; width: number };
      thumbnail?: { source: string; width: number };
    };
    if (d.type === "disambiguation") return null;
    const img = d.originalimage ?? d.thumbnail;
    if (!img || img.width < 500 || !/^https:\/\//.test(img.source) || /\.svg/i.test(img.source) || MAP_RE.test(img.source)) return null;
    return img.source;
  } catch {
    return null;
  }
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
  const tries = category === "Desporto"
    ? [term, "football stadium", "football pitch grass"]
    : [term, words.slice(-1)[0] ?? "", CATEGORY_EN[category] ?? "news"];
  for (const t of tries) {
    const img = await findHdImage(t, used);
    if (img) return img;
  }
  return null;
}

export async function runIngest(): Promise<Record<string, unknown>> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

  const { data: state } = await db.from("ingest_state").select("paused_reason").eq("id", 1).single();

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
    // limpeza: apaga notícias com mais de 24 horas
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    await db.from("articles").delete().lt("published_at", cutoff);
    // só artigos das últimas 24h, mais recentes primeiro
    const news = (await getAllNews())
      .filter((n) => n.publishedAt >= cutoff)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    // deduplicação por id e por URL do artigo, antes de chamar o Gemini
    const existing = new Set<string>();
    for (let i = 0; i < news.length; i += 100) {
      const part = news.slice(i, i + 100);
      const [byId, byUrl] = await Promise.all([
        db.from("articles").select("id").in("id", part.map((n) => n.id)),
        db.from("articles").select("url").in("url", part.map((n) => n.url)),
      ]);
      for (const r of byId.data ?? []) existing.add(r.id);
      for (const r of byUrl.data ?? []) existing.add(r.url);
    }
    // máx. 4 novas por fonte por ciclo; ordem já intercalada por fonte
    const perSrc = new Map<string, number>();
    const pending = news
      .filter((n) => {
        if (existing.has(n.id) || existing.has(n.url)) return false;
        const c = perSrc.get(n.source) ?? 0;
        if (c >= 4) return false;
        perSrc.set(n.source, c + 1);
        return true;
      })
      .slice(0, BATCH * MAX_BATCHES);

    // evita repetir a mesma foto de reserva
    const { data: recent } = await db.from("articles").select("image").not("image_query", "is", null).limit(500);
    const used = new Set((recent ?? []).map((r) => r.image).filter(Boolean) as string[]);

    // Fila indiana: Gemini → guardar → esperar 2s → próxima
    for (const [idx, n] of pending.entries()) {
      if (idx > 0) await new Promise((r) => setTimeout(r, 2000));
      const g = await generateOne(n.title);
      if (!g) continue; // sem fallback para o título original
      try {
        let image = n.image && !isLowResImage(n.image) ? n.image : null;
        let image_query: string | null = null;
        if (!image) image = await fromArticlePage(n.url);
        if (!image) {
          image_query = g.titulo;
          image = await findHdImageAny(g.titulo, n.category, used);
        }
        const { error } = await db.from("articles").upsert(
          {
            id: n.id,
            source: n.source,
            category: n.category,
            url: n.url,
            image: finalImageUrl(image, n.category, n.title),
            image_query,
            original_title: n.title,
            titulo_inedito: g.titulo,
            resumo: g.resumo,
            relevance: relevance100(n),
            published_at: n.publishedAt,
          },
          { onConflict: "id" },
        );
        if (error) console.error("gravação falhou", error);
        else inserted++;
      } catch (e) {
        console.error("notícia ignorada", e);
      }
    }

    // reprocessa notícias que ficaram sem foto (limitado)
    const { data: missing } = await db.from("articles").select("id,url,image_query,category,titulo_inedito").is("image", null).limit(20);
    for (const m of missing ?? []) {
      const img = (await fromArticlePage(m.url)) ?? (await findHdImageAny(m.image_query ?? "", m.category, used));
      await db.from("articles").update({ image: finalImageUrl(img, m.category, m.titulo_inedito) }).eq("id", m.id);
    }

    // notícias com mais de 24h são apagadas no início de cada ciclo
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
