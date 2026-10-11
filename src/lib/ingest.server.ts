import { getAllNews, relevanceScore, isLowResImage } from "./news.server";
import { generateOne, GatewayError } from "./title-generation.server";
import { generateGroqOne } from "./title-generation.groq.server";
import { finalImageUrl } from "./image-policy";
import { chooseOriginal, inspectImage } from "./image-dimensions.server";
import { adequateImage } from "./image-quality";

const BATCH = 10; // lote de processamento ampliado
const TARGET = 500; // maior arquivo recente; limpeza continua limitada às últimas 24h
const MAX_BATCHES = 10; // até 100 notícias candidatas por ciclo, sujeito a quotas/tempo das APIs

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

// Pixabay (fotografias reais) — só servidor; a chave nunca sai daqui nem é registada.
// Termos da API: URLs só para exibição temporária (as notícias são apagadas às 24h), sem descarregar/alojar.
const pixabayCache = new Map<string, Hit[]>();
async function fromPixabay(term: string, used: Set<string>) {
  const key = process.env["PIXABAY_API_KEY"];
  if (!key || !term) return null;
  const k = term.toLowerCase();
  let hits = pixabayCache.get(k);
  if (!hits) {
    const res = await fetch(
      `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(term.slice(0, 100))}&lang=pt&image_type=photo&orientation=vertical&min_width=1000&min_height=600&safesearch=true&per_page=20`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null; // quota/erro: continua com as outras fontes
    const d = (await res.json()) as { hits?: { largeImageURL: string; imageURL?: string; fullHDURL?: string; imageWidth: number; imageHeight: number; tags: string }[] };
    // só aceita resultados cujas etiquetas partilhem uma palavra com o termo (evita correspondências inventadas)
    const words = k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\W+/).filter((w) => w.length > 3 && !["para", "como", "mais", "sobre", "apos", "hoje", "anuncia", "portugal", "portugues", "noticias"].includes(w));
    hits = (d.hits ?? [])
      .filter((h) => { const tags = h.tags.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\W+/); return words.some((w) => tags.includes(w)) && adequateImage({ width: h.imageWidth, height: h.imageHeight }); })
      .map((h) => ({ url: h.imageURL ?? h.fullHDURL ?? h.largeImageURL, width: h.imageWidth, text: h.tags }));
    pixabayCache.set(k, hits);
    if (pixabayCache.size > 200) {
      const oldest = pixabayCache.keys().next().value;
      if (oldest) pixabayCache.delete(oldest);
    }
  }
  // imageWidth describes the original, NOT necessarily largeImageURL (often only 1280px).
  const candidates = hits.filter((h) => !used.has(h.url)).sort((a, b) => Number((b.width ?? 0) >= 1200) - Number((a.width ?? 0) >= 1200));
  for (const hit of candidates.slice(0, 3)) {
    const size = await inspectImage(hit.url);
    if (!size || !adequateImage(size)) continue;
    used.add(hit.url);
    return hit.url;
  }
  return null;
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
    const candidates: string[] = [];
    for (const meta of html.matchAll(/<meta\b[^>]*>/gi)) {
      if (!/(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/i.test(meta[0])) continue;
      const value = meta[0].match(/content=["']([^"']+)["']/i)?.[1];
      if (value) candidates.push(value);
    }
    // Only expand srcsets belonging to the same article photo, not unrelated page images.
    for (const img of html.matchAll(/<img\b[^>]*>/gi)) {
      const src = img[0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
      if (!src || !candidates.some((candidate) => candidate.split("?")[0] === src.split("?")[0])) continue;
      const srcset = img[0].match(/\bsrcset=["']([^"']+)["']/i)?.[1];
      const variants = (srcset ?? "").split(",").map((part) => part.trim().split(/\s+/)).sort((a, b) => (parseInt(b[1] ?? "0") || 0) - (parseInt(a[1] ?? "0") || 0));
      candidates.unshift(...variants.flatMap((variant) => variant[0] ? [variant[0]] : []));
    }
    return await chooseOriginal(candidates.map((value) => new URL(value.replace(/&amp;/g, "&").trim(), url).toString().replace(/^http:/, "https:")).filter((value) => !isLowResImage(value) && !/logo|default|placeholder|\.svg/i.test(value)));
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
  for (const fn of [fromPixabay, fromUnsplash, fromPexels, fromOpenverse]) {
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
  // Never broaden to a location/category that could misrepresent the article.
  try {
    return await fromPixabay(term, used);
  } catch {
    return null;
  }
}

export async function runIngest(): Promise<Record<string, unknown>> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

  const { data: state } = await db.from("ingest_state").select("paused_reason").eq("id", 1).single();

  const nowIso = new Date().toISOString();
  const { data: lock } = await db
    .from("ingest_state")
    .update({ locked_until: new Date(Date.now() + 10 * 60_000).toISOString(), updated_at: nowIso })
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
    // objetivo: manter até TARGET notícias recentes guardadas
    const { count: stored } = await db.from("articles").select("id", { count: "exact", head: true }).gte("published_at", cutoff);
    const news = (await getAllNews())
      .filter((n) => n.publishedAt >= cutoff)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    // Deduplicação persistente por ID/URL e por semelhança de título.
    const existing = new Set<string>();
    const [byId, byUrl] = await Promise.all([
      db.from("articles").select("id").gte("published_at", cutoff).limit(1000),
      db.from("articles").select("url").gte("published_at", cutoff).limit(1000),
    ]);
    for (const r of byId.data ?? []) existing.add(r.id);
    for (const r of byUrl.data ?? []) existing.add(normalizeArticleUrl(r.url));
    const { data: savedTitles } = await db
      .from("articles")
      .select("original_title,titulo_inedito")
      .gte("published_at", cutoff)
      .limit(500);
    const knownTitles = (savedTitles ?? []).flatMap((r) => [r.original_title, r.titulo_inedito])
      .filter((title): title is string => typeof title === "string" && title.trim().length > 0);
    // Prioridade rígida: consumir primeiro os últimos 30 minutos. Só ampliar
    // a janela quando faltarem artigos para preencher o lote, em etapas graduais.
    const desired = Math.max(0, Math.min(BATCH * MAX_BATCHES, TARGET - (stored ?? 0)));
    const fallbackWindows = [60, 180, 360, 720, 1440]; // minutos desde agora
    const candidates = news.filter((n) =>
      !existing.has(n.id) && !existing.has(normalizeArticleUrl(n.url)) && !hasSimilarTitle(n.title, knownTitles),
    );
    const perSrc = new Map<string, number>();
    const pending: typeof news = [];
    const selected = new Set<string>();
    const addWindow = (olderThanMinutes: number, newerThanMinutes: number) => {
      for (const n of candidates) {
        const ageMinutes = (Date.now() - new Date(n.publishedAt).getTime()) / 60_000;
        if (ageMinutes < olderThanMinutes || ageMinutes >= newerThanMinutes || selected.has(n.id) || hasSimilarTitle(n.title, knownTitles)) continue;
        const count = perSrc.get(n.source) ?? 0;
        if (count >= 6) continue;
        selected.add(n.id);
        perSrc.set(n.source, count + 1);
        pending.push(n);
        knownTitles.push(n.title);
        if (pending.length >= desired) return;
      }
    };
    addWindow(0, 30);
    let lowerBound = 30;
    for (const upperBound of fallbackWindows) {
      if (pending.length >= desired) break;
      addWindow(lowerBound, upperBound);
      lowerBound = upperBound;
    }
    if (pending.length < desired) addWindow(lowerBound, 72 * 60);
    pending.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

    // evita repetir a mesma foto de reserva
    const { data: recent } = await db.from("articles").select("image").not("image_query", "is", null).limit(500);
    const used = new Set((recent ?? []).map((r) => r.image).filter(Boolean) as string[]);

    // Consulta Gemini e Groq em paralelo para cada artigo. Se um falhar,
    // usa o resultado válido do outro; não faz pedidos ilimitados nem contorna quotas.
    let geminiAttempts = 0;
    let groqAttempts = 0;
    for (let offset = 0; offset < pending.length; offset += BATCH) {
      const batch = pending.slice(offset, offset + BATCH);
      const results = await Promise.all(batch.map(async (n) => {
        geminiAttempts++;
        groqAttempts++;
        const [geminiResult, groqResult] = await Promise.allSettled([
          generateOne(n.title),
          generateGroqOne(n.title),
        ]);
        const g = geminiResult.status === "fulfilled" && geminiResult.value
          ? geminiResult.value
          : groqResult.status === "fulfilled" ? groqResult.value : null;
        if (!g) {
          if (geminiResult.status === "rejected") console.error("Gemini indisponível", geminiResult.reason);
          if (groqResult.status === "rejected") console.error("Groq indisponível", groqResult.reason);
          return 0;
        }
        try {
          let image = await chooseOriginal((n.imageCandidates ?? (n.image ? [n.image] : [])).filter((url) => !isLowResImage(url)));
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
            { onConflict: "id", ignoreDuplicates: true },
          );
          if (error) {
            console.error("gravação falhou", error);
            return 0;
          }
          return 1;
        } catch (e) {
          console.error("notícia ignorada", e);
          return 0;
        }
      }));
      inserted += results.reduce((sum, count) => sum + count, 0);
    }

    // reprocessa notícias que ficaram sem foto (limitado)
    const { data: missing } = await db.from("articles").select("id,url,image_query,category,titulo_inedito").is("image", null).limit(20);
    for (const m of missing ?? []) {
      const img = (await fromArticlePage(m.url)) ?? (await findHdImageAny(m.image_query ?? "", m.category, used));
      await db.from("articles").update({ image: finalImageUrl(img, m.category, m.titulo_inedito) }).eq("id", m.id);
    }

    // notícias com mais de 24h são apagadas no início de cada ciclo
    return { inserted, pending: pending.length, geminiAttempts, groqAttempts };
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


function normalizeArticleUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|source)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\\./, "");
    url.pathname = url.pathname.replace(/\\/+$/, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function normalizeTitle(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function hasSimilarTitle(title: string, known: string[]): boolean {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;
  const tokens = new Set(normalized.split(" ").filter((word) => word.length > 2));
  if (!tokens.size) return false;
  for (const other of known) {
    const candidate = normalizeTitle(other);
    if (!candidate) continue;
    if (candidate === normalized) return true;
    const otherTokens = new Set(candidate.split(" ").filter((word) => word.length > 2));
    if (!otherTokens.size) continue;
    let intersection = 0;
    for (const token of tokens) if (otherTokens.has(token)) intersection++;
    const similarity = intersection / (tokens.size + otherTokens.size - intersection);
    if (similarity >= 0.8) return true;
  }
  return false;
}

// Relevância normalizada 0-100 a partir da lógica existente (bónus de horas sobre a data).
function relevance100(n: Parameters<typeof relevanceScore>[0]): number {
  const bonusH = (relevanceScore(n) - new Date(n.publishedAt).getTime()) / 3600_000;
  return Math.max(0, Math.min(100, Math.round(50 + bonusH * 5)));
}
