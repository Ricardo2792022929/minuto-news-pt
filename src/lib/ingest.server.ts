import { getAllNews, relevanceScore, isLowResImage, classify } from "./news.server";
import { generateOne, GatewayError, validTitle, isPastedTitle, backupTitle } from "./title-generation.server";
import { generateGroqOne } from "./title-generation.groq.server";
import { generateOpenRouterOne } from "./title-generation.openrouter.server";
import { imageKitUrl } from "./imagekit";
import { riskyImageTitle, sceneQuery } from "./image-search.server";
import { inspectImage } from "./image-dimensions.server";
import { adequateImage } from "./image-quality";

const BATCH = 6;
const MAX_BATCHES = 12;

type Hit = { url: string; width?: number; text?: string | undefined };
const MAP_RE = /\b(map|maps|mapa|atlas|globe)\b/i;
const pickRandom = (arr: Hit[], used: Set<string>) => {
  const ok = arr.filter((r) => (r.width ?? 0) >= 1000 && !MAP_RE.test(`${r.text ?? ""} ${r.url}`) && /^https:\/\//.test(r.url) && !used.has(r.url));
  const pick = ok[Math.floor(Math.random() * ok.length)]?.url ?? null;
  if (pick) used.add(pick);
  return pick;
};

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

const PIXABAY_CACHE_TTL = 20 * 60 * 60_000;
const pixabayCache = new Map<string, { expiresAt: number; hits: Hit[] }>();
async function fromPixabay(term: string, used: Set<string>) {
  const key = process.env["PIXABAY_API_KEY"] || process.env["PIXABAY_KEY"];
  if (!key || !term) return null;
  const k = term.toLowerCase();
  const cached = pixabayCache.get(k);
  let hits = cached && cached.expiresAt > Date.now() ? cached.hits : undefined;
  if (!hits) {
    const params = new URLSearchParams({
      key, q: term.slice(0, 100), lang: "pt", image_type: "photo",
      orientation: "horizontal", min_width: "800", min_height: "600",
      safesearch: "true", per_page: "20",
    });
    const res = await fetch(`https://pixabay.com/api/?${params.toString()}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = (await res.json()) as { hits?: { webformatURL: string; largeImageURL?: string; imageURL?: string; fullHDURL?: string; imageWidth: number; imageHeight: number; tags: string }[] };
    const words = k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\W+/).filter((w) => w.length > 3 && !["para", "como", "mais", "sobre", "apos", "hoje", "anuncia", "portugal", "portugues", "noticias"].includes(w));
    hits = (d.hits ?? [])
      .filter((h) => { const tags = h.tags.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\W+/); return words.some((w) => tags.includes(w)) && adequateImage({ width: h.imageWidth, height: h.imageHeight }); })
      .map((h) => ({ url: h.largeImageURL ?? h.fullHDURL ?? h.webformatURL, width: h.imageWidth, text: h.tags }));
    pixabayCache.set(k, { hits, expiresAt: Date.now() + PIXABAY_CACHE_TTL });
    if (pixabayCache.size > 200) {
      const oldest = pixabayCache.keys().next().value;
      if (oldest) pixabayCache.delete(oldest);
    }
  }
  const candidates = hits.filter((h) => !used.has(h.url)).sort((a, b) => Number((b.width ?? 0) >= 1200) - Number((a.width ?? 0) >= 1200));
  for (const hit of candidates.slice(0, 3)) {
    const size = await inspectImage(hit.url);
    if (!size || !adequateImage(size)) continue;
    used.add(hit.url);
    return hit.url;
  }
  return null;
}

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
    return candidates.find((v) => !isLowResImage(v) && !/logo|default|placeholder|\.svg/i.test(v)) ?? null;
  } catch {
    return null;
  }
}

async function fromWikipedia(entity: string): Promise<string | null> {
  if (!entity) return null;
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity.trim().replace(/\s+/g, "_"))}?redirect=true`,
      { headers: { "User-Agent": "FlashNoticias/1.0 (news app)" }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { type?: string; originalimage?: { source: string; width: number }; thumbnail?: { source: string; width: number } };
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
  const query = (await sceneQuery(term)).trim();
  if (!query) return null;
  if (query.split(/\s+/).length >= 2) {
    try {
      const wiki = await fromWikipedia(query);
      if (wiki && !used.has(wiki)) {
        used.add(wiki);
        return wiki;
      }
    } catch { /* continua */ }
  }
  for (const fn of [fromPexels, fromUnsplash, fromPixabay, fromOpenverse]) {
    try {
      const img = await fn(query, used);
      if (img) return img;
    } catch { /* tenta a seguinte */ }
  }
  return null;
}

export async function runIngest(): Promise<Record<string, unknown>> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
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
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    await db.from("articles").delete().lt("published_at", cutoff);
    const news = (await getAllNews()).filter((n) => n.publishedAt >= cutoff).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const existing = new Set<string>();
    const [byId, byUrl] = await Promise.all([
      db.from("articles").select("id").gte("published_at", cutoff).limit(1000),
      db.from("articles").select("url").gte("published_at", cutoff).limit(1000),
    ]);
    for (const r of byId.data ?? []) existing.add(r.id);
    for (const r of byUrl.data ?? []) existing.add(normalizeArticleUrl(r.url));
    const { data: savedTitles } = await db.from("articles").select("original_title,titulo_inedito").gte("published_at", cutoff).limit(500);
    const knownTitles = (savedTitles ?? []).flatMap((r) => [r.original_title, r.titulo_inedito]).filter((title): title is string => typeof title === "string" && title.trim().length > 0);
    const desired = BATCH * MAX_BATCHES;
    const fallbackWindows = [60, 180, 360, 720, 1440];
    const candidates = news.filter((n) => !existing.has(n.id) && !existing.has(normalizeArticleUrl(n.url)) && !hasSimilarTitle(n.title, knownTitles));
    const pending: typeof news = [];
    const selected = new Set<string>();
    const addWindow = (olderThanMinutes: number, newerThanMinutes: number) => {
      for (const n of candidates) {
        const ageMinutes = (Date.now() - new Date(n.publishedAt).getTime()) / 60_000;
        if (ageMinutes < olderThanMinutes || ageMinutes >= newerThanMinutes || selected.has(n.id) || hasSimilarTitle(n.title, knownTitles)) continue;
        selected.add(n.id);
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

    const used = new Set<string>();
    let geminiAttempts = 0, groqAttempts = 0, openrouterAttempts = 0;
    for (let offset = 0; offset < pending.length; offset += BATCH) {
      const batch = pending.slice(offset, offset + BATCH);
      const results = await Promise.all(batch.map(async (n) => {
        let g: Awaited<ReturnType<typeof generateGroqOne>> = null;
        groqAttempts++;
        try { g = await generateGroqOne(n.title); } catch { /* continua */ }
        if (!g) { geminiAttempts++; try { g = await generateOne(n.title); } catch { /* continua */ } }
        if (!g) { openrouterAttempts++; try { g = await generateOpenRouterOne(n.title); } catch { /* continua */ } }
        const titulo = (g && validTitle(g.titulo, n.title)) || backupTitle(n.title);
        const resumo = g?.resumo || n.excerpt?.trim().slice(0, 300) || titulo;
        try {
          // 1. Foto da página da notícia (a que o jornal escolheu)
          let image = await fromArticlePage(n.url);
          // 2. Só se a página não tiver foto, usa a do RSS
          if (!image) image = (n.imageCandidates ?? (n.image ? [n.image] : [])).find((url) => url && !isLowResImage(url)) ?? null;
          const image_query: string | null = image ? null : titulo;
          const category = classify(`${n.title} ${n.excerpt ?? ""}`, n.category);
          const { error } = await db.from("articles").upsert({
            id: n.id, source: n.source, category, url: n.url,
            image: finalImageUrl(image, category, n.title, n.id) || guaranteedImage(n.id, category),
            image_query, original_title: n.title, titulo_inedito: titulo,
            resumo, relevance: relevance100(n), published_at: n.publishedAt,
          }, { onConflict: "id", ignoreDuplicates: true });
          if (error) return 0;
          return 1;
        } catch { return 0; }
      }));
      inserted += results.reduce((sum, count) => sum + count, 0);
    }

    // Enriquecer as que ainda não têm imagem
    const { data: missing } = await db.from("articles").select("id,url,image_query,category,titulo_inedito").not("image_query", "is", null).limit(16);
    await Promise.all((missing ?? []).map(async (m) => {
      const term = (m.titulo_inedito ?? m.image_query ?? "").trim();
      try {
        const img = (await fromArticlePage(m.url)) ?? (await findHdImage(term, used));
        if (!img) return;
        await db.from("articles").update({ image: finalImageUrl(img, m.category, m.titulo_inedito, m.id) || guaranteedImage(m.id, m.category), image_query: null }).eq("id", m.id);
      } catch { /* ignore */ }
    }));

    // Prepara as fotos novas: a ImageKit analisa, centra e fica em cache antes de abrirem a app.
    const { data: toPrepare } = await db.from("articles").select("image").order("published_at", { ascending: false }).limit(24);
    await Promise.all((toPrepare ?? []).map(async (row) => {
      const kit = imageKitUrl(row.image);
      if (!kit) return;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8_000);
      try {
        await fetch(kit, { signal: ctrl.signal });
      } catch {
        /* a próxima atualização tenta outra vez */
      } finally {
        clearTimeout(timer);
      }
    }));

    const { data: recent } = await db.from("articles").select("id, original_title, titulo_inedito").order("published_at", { ascending: false }).limit(40);
    let rewritten = 0;
    for (const row of recent ?? []) {
      if (rewritten >= 6) break;
      if (!row.original_title || !row.titulo_inedito) continue;
      const pasted = isPastedTitle(row.titulo_inedito, row.original_title) || !validTitle(row.titulo_inedito, row.original_title);
      if (!pasted) continue;
      let next: string | null = null;
      try { next = (await generateOne(row.original_title))?.titulo ?? null; } catch { /* tenta a seguinte */ }
      if (!next) { try { next = (await generateGroqOne(row.original_title))?.titulo ?? null; } catch { /* tenta a seguinte */ } }
      if (!next) { try { next = (await generateOpenRouterOne(row.original_title))?.titulo ?? null; } catch { /* ignora */ } }
      if (!next || next === row.titulo_inedito) continue;
      const { error } = await db.from("articles").update({ titulo_inedito: next }).eq("id", row.id);
      if (!error) rewritten++;
    }

    const { data: tagged } = await db
      .from("articles")
      .select("id, original_title, titulo_inedito, resumo, category")
      .order("published_at", { ascending: false })
      .limit(150);
    let recategorized = 0;
    for (const row of tagged ?? []) {
      const text = [row.original_title, row.titulo_inedito, row.resumo].filter(Boolean).join(" ");
      const next = classify(text, row.category || "Mundo");
      if (!next || next === row.category) continue;
      const { error } = await db.from("articles").update({ category: next }).eq("id", row.id);
      if (!error) recategorized++;
    }

    const sameImage = (a: string, b: string) => {
      try {
        const left = new URL(a);
        const right = new URL(b);
        return left.hostname === right.hostname && left.pathname === right.pathname;
      } catch {
        return a === b;
      }
    };
    const { data: recentImgs } = await db
      .from("articles")
      .select("id,url,image,category,titulo_inedito,original_title")
      .order("published_at", { ascending: false })
      .limit(18);
    const { data: namedImgs } = await db
      .from("articles")
      .select("id,url,image,category,titulo_inedito,original_title")
      .or("titulo_inedito.ilike.%Leão%,titulo_inedito.ilike.%Leao%,original_title.ilike.%Leão%,original_title.ilike.%Leao%")
      .limit(8);
    const imageRows = [...(namedImgs ?? []), ...(recentImgs ?? [])];
    const seenImages = new Set<string>();
    for (const row of imageRows) {
      if (!row.url || seenImages.has(row.id)) continue;
      seenImages.add(row.id);
      try {
        const pageImg = await fromArticlePage(row.url);
        if (pageImg && !(row.image && sameImage(row.image, pageImg))) {
          await db
            .from("articles")
            .update({
              image: finalImageUrl(pageImg, row.category, row.titulo_inedito, row.id) || guaranteedImage(row.id, row.category),
              image_query: null,
            })
            .eq("id", row.id);
          continue;
        }
        const stock = /unsplash|pexels|pixabay|wikimedia|picsum|openverse/i.test(row.image ?? "");
        if (!stock || !riskyImageTitle(`${row.original_title ?? ""} ${row.titulo_inedito ?? ""}`)) continue;
        const img = await findHdImage(`${row.original_title ?? ""} ${row.titulo_inedito ?? ""}`, used);
        if (!img || (row.image && sameImage(row.image, img))) continue;
        await db
          .from("articles")
          .update({
            image: finalImageUrl(img, row.category, row.titulo_inedito, row.id) || guaranteedImage(row.id, row.category),
            image_query: null,
          })
          .eq("id", row.id);
      } catch {
        /* ignora */
      }
    }

    return { inserted, pending: pending.length, geminiAttempts, groqAttempts, openrouterAttempts, rewritten, recategorized };
  } catch (e) {
    if (e instanceof GatewayError && (e.status === 402 || e.status === 403)) {
      await db.from("ingest_state").update({ paused_reason: `${e.status}: ${e.message}` }).eq("id", 1);
    }
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
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch { return raw.trim(); }
}

function normalizeTitle(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function hasSimilarTitle(title: string, known: string[]): boolean {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;
  const tokens = new Set(normalized.split(" ").filter((word) => word.length > 2));
  if (!tokens.size) return false;
  for (const other of known) {
    const candidate = normalizeTitle(other);
    if (!candidate || candidate === normalized) return true;
    const otherTokens = new Set(candidate.split(" ").filter((word) => word.length > 2));
    if (!otherTokens.size) continue;
    let intersection = 0;
    for (const token of tokens) if (otherTokens.has(token)) intersection++;
    if (intersection / (tokens.size + otherTokens.size - intersection) >= 0.8) return true;
  }
  return false;
}

function relevance100(n: Parameters<typeof relevanceScore>[0]): number {
  const bonusH = (relevanceScore(n) - new Date(n.publishedAt).getTime()) / 3600_000;
  return Math.max(0, Math.min(100, Math.round(50 + bonusH * 5)));
}
