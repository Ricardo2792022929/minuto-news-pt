import { getAllNews, relevanceScore, isLowResImage, classify } from "./news.server";
import { generateOne, GatewayError, validTitle, isPublishableTitle } from "./title-generation.server";
import { generateGroqOne } from "./title-generation.groq.server";
import { generateOpenRouterOne } from "./title-generation.openrouter.server";
import { generateNvidiaOne } from "./title-generation.nvidia.server";
import { generateCloudflareOne } from "./title-generation.cloudflare.server";
import { imageKitUrl } from "./imagekit";
import { finalImageUrl, guaranteedImage } from "./image-policy";
import { sceneQuery, imageSearchTerms } from "./image-search.server";
import { inspectImage, chooseOriginal } from "./image-dimensions.server";
import { adequateImage } from "./image-quality";

const BATCH = 10;
const MAX_BATCHES = 2;
const BUDGET_MS = 26_000;
type ImageMetric = { requests: number; resultsFound: number; accepted: number; failures: number; latencyMs: number; rejectionReasons: Record<string, number> };
let imageMetrics: Record<string, ImageMetric> = {};
function metric(service: string): ImageMetric { return imageMetrics[service] ??= { requests: 0, resultsFound: 0, accepted: 0, failures: 0, latencyMs: 0, rejectionReasons: {} }; }
function rejectImage(service: string, reason: string) { const m = metric(service); m.rejectionReasons[reason] = (m.rejectionReasons[reason] ?? 0) + 1; }
function missingImageKey(service: string) { metric(service).failures++; rejectImage(service, "missing_api_key"); }
async function imageRequest(service: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const m = metric(service), started = Date.now(); m.requests++;
  try {
    const response = await fetch(input, init);
    if (!response.ok) { m.failures++; rejectImage(service, `http_${response.status}`); }
    else try { const payload = await response.clone().json() as Record<string, unknown>; for (const key of ["results", "photos", "hits", "pages"]) if (Array.isArray(payload[key])) { m.resultsFound += (payload[key] as unknown[]).length; break; } } catch { /* resposta sem JSON */ }
    return response;
  } catch (error) { m.failures++; rejectImage(service, error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error"); throw error; }
  finally { m.latencyMs += Date.now() - started; }
}

type Hit = { url: string; width?: number; text?: string | undefined };
const MAP_RE = /\b(map|maps|mapa|atlas|globe)\b/i;
const IMAGE_STOP_WORDS = new Set([
  "para", "como", "mais", "sobre", "apos", "depois", "antes", "hoje", "ontem",
  "anuncia", "anunciou", "diz", "disse", "afirma", "revela", "chega", "chegou",
  "portugal", "portugues", "portuguesa", "noticia", "noticias", "investimento",
  "milhoes", "milhao", "euros", "novo", "nova", "novos", "novas", "pode", "podem",
  "com", "sem", "entre", "contra", "sobre", "devido", "apos", "segundo"
]);
const normalizeImageText = (value: string) => value.toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const pickBest = (arr: Hit[], used: Set<string>, term: string, service: string) => {
  const words = [...new Set(normalizeImageText(term).filter((word) => word.length > 3 && !IMAGE_STOP_WORDS.has(word)))];
  if (!words.length) { rejectImage(service, "no_specific_terms"); return null; }
  const candidates = arr.filter((r) => (r.width ?? 0) >= 640 && !MAP_RE.test(`${r.text ?? ""} ${r.url}`) && /^https:\/\//.test(r.url) && !used.has(r.url))
    .map((r) => {
      const textWords = new Set(normalizeImageText(`${r.text ?? ""} ${r.url}`));
      const matches = words.filter((word) => textWords.has(word) || [...textWords].some((candidate) => candidate.length > 4 && word.length > 4 && (candidate.startsWith(word.slice(0, 5)) || word.startsWith(candidate.slice(0, 5)))));
      const phrase = normalizeImageText(r.text ?? "").join(" "), title = normalizeImageText(term).join(" ");
      const bonus = title.length > 12 && phrase.includes(title.slice(0, 18)) ? 2 : 0;
      return { ...r, score: matches.reduce((sum, word) => sum + (word.length >= 7 ? 2 : 1), 0) + bonus };
    }).filter((r) => r.score >= (words.length <= 2 ? 1 : 2)).sort((x, y) => y.score - x.score || (y.width ?? 0) - (x.width ?? 0));
  const pick = candidates.find((r) => !used.has(r.url))?.url ?? null;
  if (pick) { used.add(pick); metric(service).accepted++; }
  else rejectImage(service, arr.length ? "not_relevant_or_too_small" : "no_results");
  return pick;
};

async function fromUnsplash(term: string, used: Set<string>) {
  const key = process.env["UNSPLASH_ACCESS_KEY"];
  if (!key) { missingImageKey("unsplash"); return null; }
  const page = 1;
  const res = await imageRequest("unsplash",
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(term)}&orientation=landscape&per_page=20&page=${page}&content_filter=high`,
    { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { results?: { width: number; alt_description?: string; description?: string; urls: { raw: string } }[] };
  return pickBest((d.results ?? []).map((r) => { const imageUrl = new URL(r.urls.raw); imageUrl.searchParams.set("w", "1600"); imageUrl.searchParams.set("q", "80"); imageUrl.searchParams.set("fit", "crop"); return { url: imageUrl.toString(), width: r.width, text: `${r.alt_description ?? ""} ${r.description ?? ""}` }; }), used, term, "unsplash");
}

const PIXABAY_CACHE_TTL = 20 * 60 * 60_000;
const pixabayCache = new Map<string, { expiresAt: number; hits: Hit[] }>();
async function fromPixabay(term: string, used: Set<string>) {
  const key = process.env["PIXABAY_API_KEY"] || process.env["PIXABAY_KEY"];
  if (!key) { missingImageKey("pixabay"); return null; }
  if (!term) return null;
  const k = term.toLowerCase();
  const cached = pixabayCache.get(k);
  let hits = cached && cached.expiresAt > Date.now() ? cached.hits : undefined;
  if (!hits) {
    const params = new URLSearchParams({
      key, q: term.slice(0, 100), lang: "pt", image_type: "photo",
      orientation: "horizontal", min_width: "1000", min_height: "600",
      safesearch: "true", per_page: "20",
    });
    const res = await imageRequest("pixabay", `https://pixabay.com/api/?${params.toString()}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = (await res.json()) as { hits?: { webformatURL: string; largeImageURL?: string; imageURL?: string; fullHDURL?: string; imageWidth: number; imageHeight: number; tags: string }[] };
    const words = [...new Set(normalizeImageText(term).filter((word) => word.length > 3 && !IMAGE_STOP_WORDS.has(word)))];
    hits = (d.hits ?? [])
      .filter((h) => {
        const tags = new Set(normalizeImageText(h.tags));
        const matches = words.filter((word) => tags.has(word)).length;
        const minimumMatches = words.length <= 1 ? 1 : 2;
        return matches >= minimumMatches && adequateImage({ width: h.imageWidth, height: h.imageHeight });
      })
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
  if (!key) { missingImageKey("pexels"); return null; }
  const page = 1;
  const res = await imageRequest("pexels",
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(term)}&orientation=landscape&per_page=20&page=${page}`,
    { headers: { Authorization: key }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { photos?: { width: number; alt?: string; src: { large2x: string } }[] };
  return pickBest((d.photos ?? []).map((p) => ({ url: p.src.large2x, width: p.width, text: p.alt })), used, term, "pexels");
}

async function fromOpenverse(term: string, used: Set<string>) {
  const page = 1;
  const res = await imageRequest("openverse",
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&size=large&category=photograph&page_size=20&page=${page}&mature=false`,
    { headers: { "User-Agent": "FlashNoticias/1.0" }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { results?: (Hit & { title?: string })[] };
  return pickBest((d.results ?? []).map((r) => ({ ...r, text: r.title })), used, term, "openverse");
}

async function fromWikimediaCommons(term: string, used: Set<string>) {
  if (!term.trim()) return null;
  // Use Wikimedia's REST search first, then retrieve Commons file metadata
  // through the MediaWiki API so we can enforce the license policy.
  const restUrl = new URL("https://commons.wikimedia.org/w/rest.php/v1/search/page");
  restUrl.searchParams.set("q", term.slice(0, 100));
  restUrl.searchParams.set("limit", "30");
  const res = await imageRequest("wikimedia", restUrl.toString(), {
    headers: { "User-Agent": "MinutoNews/1.0 (news image search)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const searchData = (await res.json()) as {
    pages?: { title?: string; thumbnail?: { url?: string; width?: number; height?: number } | null }[];
  };
  const titles = (searchData.pages ?? [])
    .map((page) => page.title ?? "")
    .filter((title) => /^File:/i.test(title))
    .slice(0, 20);
  if (!titles.length) return null;

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "imageinfo",
    titles: titles.join("|"),
    iiprop: "url|size|extmetadata",
    iiurlwidth: "1600",
  });
  const metaRes = await imageRequest("wikimedia", `https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
    headers: { "User-Agent": "MinutoNews/1.0 (news image search)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!metaRes.ok) return null;
  const metadata = (await metaRes.json()) as {
    query?: { pages?: Record<string, { title?: string; imageinfo?: { thumburl?: string; url?: string; width?: number; height?: number; extmetadata?: { LicenseShortName?: { value?: string } } }[] }> };
  };
  const hits: Hit[] = Object.values(metadata.query?.pages ?? []).flatMap((page) => {
    const info = page.imageinfo?.[0];
    const license = info?.extmetadata?.LicenseShortName?.value ?? "";
    if (!info || !/(public domain|cc0|creative commons zero)/i.test(license)) return [];
    const url = info.thumburl ?? info.url;
    if (!url || !/^https:\/\//.test(url) || /\.svg(?:\?|$)/i.test(url)) return [];
    return [{ url, width: info.width ?? 0, text: page.title ?? "" }];
  });
  return pickBest(hits, used, term, "wikimedia");
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
      const tag = meta[0];
      const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!property || !["og:image", "og:image:secure_url", "twitter:image"].includes(property)) continue;
      const value = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&");
      if (!value) continue;
      try {
        const imageUrl = new URL(value, url);
        if (imageUrl.protocol === "https:") candidates.push(imageUrl.toString());
      } catch { /* metadado inválido */ }
    }
    return await chooseOriginal(candidates);
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
  if (!term.trim()) return null;
  const queries = imageSearchTerms(term);
  const preferred = await sceneQuery(term);
  if (preferred && !queries.includes(preferred)) queries.unshift(preferred);
  const providers: [string, (query: string, used: Set<string>) => Promise<string | null][] = [
    ["pexels", fromPexels], ["unsplash", fromUnsplash], ["pixabay", fromPixabay],
    ["wikimedia", fromWikimediaCommons], ["openverse", fromOpenverse],
  ];
  for (const query of queries.slice(0, 3)) for (const [service, provider] of providers) {
    try { const img = await provider(query, used); if (img) return img; }
    catch { rejectImage(service, "provider_error"); }
  }
  return null;
}

export async function runIngest(): Promise<Record<string, unknown>> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const started = Date.now();
  imageMetrics = {};
  const expired = () => Date.now() - started > BUDGET_MS;
  const nowIso = new Date().toISOString();
  const until = new Date(Date.now() + 3 * 60_000).toISOString();
  const { data: current } = await db.from("ingest_state").select("id, locked_until").eq("id", 1).maybeSingle();
  const lockedUntil = current?.locked_until ? new Date(current.locked_until).getTime() : 0;
  if (lockedUntil > Date.now() && lockedUntil < Date.now() + 4 * 60_000) return { skipped: "locked" };
  const { error: lockError } = await db.from("ingest_state").upsert(
    { id: 1, locked_until: until, updated_at: nowIso },
    { onConflict: "id" },
  );
  if (lockError) return { error: lockError.message };

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
    let geminiAttempts = 0, groqAttempts = 0, openrouterAttempts = 0, nvidiaAttempts = 0, cloudflareAttempts = 0;
    let saveError: string | null = null;
    const queue = pending.slice(0, 20);
    for (let offset = 0; offset < queue.length; offset += 10) {
      if (expired()) break;
      const wave = queue.slice(offset, offset + 10);
      const titled = await Promise.all(wave.map(async (n) => {
        let g: Awaited<ReturnType<typeof generateGroqOne>> = null;
        groqAttempts++;
        try { g = await generateGroqOne(n.title); } catch { /* tenta a seguinte */ }
        if (!g) { cloudflareAttempts++; try { g = await generateCloudflareOne(n.title); } catch { /* entra na mesma */ } }
        if (!g) { nvidiaAttempts++; try { g = await generateNvidiaOne(n.title); } catch { /* entra na mesma */ } }
        if (!g) { geminiAttempts++; try { g = await generateOne(n.title); } catch { /* tenta a seguinte */ } }
        if (!g) { openrouterAttempts++; try { g = await generateOpenRouterOne(n.title); } catch { /* entra na mesma */ } }
        const ai = g && validTitle(g.titulo, n.title);
        if (!ai || !isPublishableTitle(ai, n.title)) return null;
        return { n, titulo: ai, resumo: g?.resumo || n.excerpt?.trim() || ai };
      }));
      const verifiedImages = await Promise.all(titled.map((item) =>
        item ? chooseOriginal(item.n.imageCandidates ?? (item.n.image ? [item.n.image] : [])) : Promise.resolve(null)
      ));
      for (let itemIndex = 0; itemIndex < titled.length; itemIndex++) {
        const item = titled[itemIndex];
        if (!item) continue;
        const { n, titulo, resumo } = item;
        const category = classify(`${n.title} ${n.excerpt ?? ""}`, n.category || "Mundo");
        const rawImage = verifiedImages[itemIndex] ?? null;
        const row = {
          id: n.id,
          source: (n.source || "Lusa").slice(0, 120),
          category,
          url: n.url.slice(0, 2000),
          image: finalImageUrl(rawImage, category, n.title, n.id) || guaranteedImage(n.id, category),
          image_status: rawImage ? "original" : "provisional",
          image_candidates: (n.imageCandidates ?? []).filter((candidate) => candidate !== rawImage).slice(0, 4),
          image_query: rawImage ? null : `${n.title} ${n.excerpt ?? ""}`.trim().slice(0, 500),
          original_title: n.title.slice(0, 500),
          titulo_inedito: titulo.slice(0, 180),
          resumo: resumo.slice(0, 300),
          relevance: relevance100(n),
          published_at: n.publishedAt,
        };
        let { error } = await db.from("articles").insert(row);
        if (error && error.code !== "23505") {
          const again = await db.from("articles").insert({ ...row, image_query: row.image_query, image_status: "provisional", image: guaranteedImage(n.id, category) });
          error = again.error;
        }
        if (error) {
          if (error.code === "23505") continue;
          saveError ??= `${error.code ?? ""} ${error.message}${error.hint ? ` (${error.hint})` : ""}`.trim();
          continue;
        }
        inserted++;
      }
    }

    // Enriquecer as que ainda não têm imagem
    let rewritten = 0;
    let recategorized = 0;
    if (!expired()) {
      const { data: missing } = await db.from("articles").select("id,url,image_query,image_status,original_title,resumo,category,titulo_inedito").not("image_query", "is", null).limit(4);
      await Promise.all((missing ?? []).map(async (m) => {
        const term = [m.original_title, m.titulo_inedito, m.resumo, m.image_query].filter(Boolean).join(" ").trim();
        try {
          const img = (await fromArticlePage(m.url)) ?? (await findHdImage(term, used));
          if (!img) return;
          await db.from("articles").update({ image: finalImageUrl(img, m.category, m.original_title ?? m.titulo_inedito, m.id) || guaranteedImage(m.id, m.category), image_status: "search", image_candidates: [img], image_query: null }).eq("id", m.id);
        } catch { /* ignore */ }
      }));
    }

    if (!expired()) {
      const { data: toPrepare } = await db.from("articles").select("image").order("published_at", { ascending: false }).limit(8);
      await Promise.all((toPrepare ?? []).map(async (row) => {
        const kit = imageKitUrl(row.image);
        if (!kit) return;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2_500);
        try {
          await fetch(kit, { signal: ctrl.signal });
        } catch {
          /* a próxima atualização tenta outra vez */
        } finally {
          clearTimeout(timer);
        }
      }));
    }

    if (!expired()) {
      const { data: recent } = await db.from("articles").select("id, original_title, titulo_inedito").order("published_at", { ascending: false }).limit(20);
      for (const row of recent ?? []) {
        if (expired() || rewritten >= 12) break;
        if (!row.original_title || !row.titulo_inedito) continue;
        const pasted = !isPublishableTitle(row.titulo_inedito, row.original_title);
        if (!pasted) continue;
        let next: string | null = null;
        try { next = (await generateGroqOne(row.original_title))?.titulo ?? null; } catch { /* tenta a seguinte */ }
        if (!next) { try { next = (await generateCloudflareOne(row.original_title))?.titulo ?? null; } catch { /* ignora */ } }
        if (!next) { try { next = (await generateNvidiaOne(row.original_title))?.titulo ?? null; } catch { /* ignora */ } }
        if (!next) { try { next = (await generateOne(row.original_title))?.titulo ?? null; } catch { /* tenta a seguinte */ } }
        if (!next) { try { next = (await generateOpenRouterOne(row.original_title))?.titulo ?? null; } catch { /* ignora */ } }
        if (!next || next === row.titulo_inedito) continue;
        const { error } = await db.from("articles").update({ titulo_inedito: next }).eq("id", row.id);
        if (!error) rewritten++;
      }
    }

    if (!expired()) {
      const { data: tagged } = await db
        .from("articles")
        .select("id, original_title, titulo_inedito, resumo, category")
        .order("published_at", { ascending: false })
        .limit(40);
      for (const row of tagged ?? []) {
        const text = [row.original_title, row.titulo_inedito, row.resumo].filter(Boolean).join(" ");
        const next = classify(text, row.category || "Mundo");
        if (!next || next === row.category) continue;
        const { error } = await db.from("articles").update({ category: next }).eq("id", row.id);
        if (!error) recategorized++;
      }
    }

    const imageMetricsRows = Object.entries(imageMetrics).map(([service, values]) => ({ service, ...values, rejection_reasons: values.rejectionReasons }));
    if (imageMetricsRows.length) {
      const metricRows = Object.entries(imageMetrics).map(([service, value]) => ({
        service, requests: value.requests, results_found: value.resultsFound, accepted: value.accepted,
        failures: value.failures, latency_ms: value.latencyMs, rejection_reasons: value.rejectionReasons,
      }));
      const { error: metricsError } = await db.from("image_api_metrics").insert(metricRows);
      if (metricsError) console.error("image_api_metrics_write_failed", metricsError.message);
    }
    console.info("image_api_metrics", JSON.stringify(imageMetricsRows));
    return { inserted, pending: pending.length, saveError, geminiAttempts, groqAttempts, openrouterAttempts, nvidiaAttempts, cloudflareAttempts, rewritten, recategorized, imageMetrics: imageMetricsRows };
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
