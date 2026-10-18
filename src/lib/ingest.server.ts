import { AsyncLocalStorage } from "node:async_hooks";
import { getAllNews, relevanceScore, isLowResImage, classify } from "./news.server";
import { generateOne, GatewayError, validTitle, isPublishableTitle, backupTitle, swapsStoryActor } from "./title-generation.server";
import { generateGroqOne } from "./title-generation.groq.server";
import { generateOpenRouterOne } from "./title-generation.openrouter.server";
import { generateNvidiaOne } from "./title-generation.nvidia.server";
import { scrapeArticleText } from "./article-scrape.server";
import { imageKitUrl } from "./imagekit";
import { storyImageUrl } from "./image-policy";
import { imageSearchTerms, storyEntities } from "./image-search.server";
import { imageAlreadyUsed, rememberImage, scoreCandidate, wikipediaPageFits } from "./image-relevance";
import { imageFromArticlePage, imageFromSameStory } from "./article-image.server";
import { chooseOriginal } from "./image-dimensions.server";
import { adequateImage } from "./image-quality";

const BATCH = 10;
const MAX_BATCHES = 2;
const BUDGET_MS = 18_000;
type ImageMetric = { requests: number; resultsFound: number; accepted: number; failures: number; latencyMs: number; rejectionReasons: Record<string, number> };
const imageMetricsStore = new AsyncLocalStorage<Record<string, ImageMetric>>();
function emptyMetric(): ImageMetric { return { requests: 0, resultsFound: 0, accepted: 0, failures: 0, latencyMs: 0, rejectionReasons: {} }; }
function metric(service: string): ImageMetric {
  const bag = imageMetricsStore.getStore();
  if (!bag) return emptyMetric();
  return bag[service] ??= emptyMetric();
}
function rejectImage(service: string, reason: string) { const m = metric(service); m.rejectionReasons[reason] = (m.rejectionReasons[reason] ?? 0) + 1; }
function missingImageKey(service: string) { metric(service).failures++; rejectImage(service, "missing_api_key"); }
async function imageRequest(service: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const m = metric(service), started = Date.now(); m.requests++;
  try {
    const response = await fetch(input, init);
    if (!response.ok) { m.failures++; rejectImage(service, `http_${response.status}`); }
    else try {
      const payload = await response.clone().json() as Record<string, unknown>;
      for (const key of ["results", "photos", "hits", "pages"]) {
        if (Array.isArray(payload[key])) {
          const count = (payload[key] as unknown[]).length;
          m.resultsFound += count;
          if (!count) rejectImage(service, "no_results");
          break;
        }
      }
    } catch { /* resposta sem JSON */ }
    return response;
  } catch (error) {
    m.failures++;
    const name = error instanceof Error ? error.name : "";
    rejectImage(service, name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error");
    throw error;
  } finally { m.latencyMs += Date.now() - started; }
}

type Hit = { url: string; width?: number; text?: string | undefined };
const MAP_RE = /\b(map|maps|mapa|atlas|globe)\b/i;
const pickBest = (arr: Hit[], used: Set<string>, storyTitle: string, service: string, description = "") => {
  const candidates = arr.filter((item) => (item.width ?? 0) >= 640 && !MAP_RE.test(`${item.text ?? ""} ${item.url}`) && /^https:\/\//.test(item.url) && !imageAlreadyUsed(used, item.url))
    .map((item) => ({ ...item, judgment: scoreCandidate(storyTitle, description, item.text ?? "", item.url) }))
    .filter((item) => item.judgment.accepted)
    .sort((left, right) => right.judgment.score - left.judgment.score || (right.width ?? 0) - (left.width ?? 0));
  const pick = candidates[0]?.url ?? null;
  if (pick) { rememberImage(used, pick); metric(service).accepted++; }
  else rejectImage(service, arr.length ? "rejected_candidate" : "no_results");
  return pick;
};

async function fromUnsplash(term: string, used: Set<string>, storyTitle = term, description = "") {
  const key = process.env["UNSPLASH_ACCESS_KEY"];
  if (!key) { missingImageKey("unsplash"); return null; }
  const page = 1;
  const res = await imageRequest("unsplash",
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(term)}&orientation=landscape&per_page=20&page=${page}&content_filter=high`,
    { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { results?: { width: number; alt_description?: string; description?: string; urls: { raw: string } }[] };
  return pickBest((d.results ?? []).map((r) => { const imageUrl = new URL(r.urls.raw); imageUrl.searchParams.set("w", "1600"); imageUrl.searchParams.set("q", "80"); imageUrl.searchParams.set("fit", "crop"); return { url: imageUrl.toString(), width: r.width, text: `${r.alt_description ?? ""} ${r.description ?? ""}` }; }), used, storyTitle, "unsplash", description);
}

const PIXABAY_CACHE_TTL = 20 * 60 * 60_000;
const pixabayCache = new Map<string, { expiresAt: number; hits: Hit[] }>();
async function fromPixabay(term: string, used: Set<string>, storyTitle = term, description = "") {
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
    hits = (d.hits ?? [])
      .filter((h) => adequateImage({ width: h.imageWidth, height: h.imageHeight }))
      .map((h) => ({ url: h.largeImageURL ?? h.fullHDURL ?? h.webformatURL, width: h.imageWidth, text: h.tags }));
    pixabayCache.set(k, { hits, expiresAt: Date.now() + PIXABAY_CACHE_TTL });
    if (pixabayCache.size > 200) {
      const oldest = pixabayCache.keys().next().value;
      if (oldest) pixabayCache.delete(oldest);
    }
  }
  return pickBest(hits, used, storyTitle, "pixabay", description);
}

async function fromPexels(term: string, used: Set<string>, storyTitle = term, description = "") {
  const key = process.env["PEXELS_API_KEY"];
  if (!key) { missingImageKey("pexels"); return null; }
  const page = 1;
  const res = await imageRequest("pexels",
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(term)}&orientation=landscape&per_page=20&page=${page}`,
    { headers: { Authorization: key }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { photos?: { width: number; alt?: string; src: { large2x: string } }[] };
  return pickBest((d.photos ?? []).map((p) => ({ url: p.src.large2x, width: p.width, text: p.alt })), used, storyTitle, "pexels", description);
}

async function fromOpenverse(term: string, used: Set<string>, storyTitle = term, description = "") {
  const page = 1;
  const res = await imageRequest("openverse",
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&size=large&category=photograph&page_size=20&page=${page}&mature=false`,
    { headers: { "User-Agent": "FlashNoticias/1.0" }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { results?: (Hit & { title?: string; description?: string })[] };
  return pickBest((d.results ?? []).map((r) => ({ ...r, text: `${r.title ?? ""} ${r.description ?? ""}` })), used, storyTitle, "openverse", description);
}

async function fromWikimediaCommons(term: string, used: Set<string>, storyTitle = term, description = "") {
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
  if (!titles.length) { rejectImage("wikimedia", searchData.pages?.length ? "rejected_candidate" : "no_results"); return null; }

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
  return pickBest(hits, used, storyTitle, "wikimedia", description);
}

async function fromArticlePage(url: string): Promise<string | null> {
  try {
    const chosen = await imageFromArticlePage(url);
    if (!chosen) { rejectImage("article", "no_results"); return null; }
    metric("article").accepted++;
    return chosen;
  } catch {
    return null;
  }
}

async function fromWikipedia(entity: string): Promise<string | null> {
  if (!entity) return null;
  for (const host of ["pt.wikipedia.org", "en.wikipedia.org"]) {
    try {
      const res = await imageRequest("wikipedia",
        `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(entity.trim().replace(/\s+/g, "_"))}?redirect=true`,
        { headers: { "User-Agent": "FlashNoticias/1.0 (news app)" }, signal: AbortSignal.timeout(4000) },
      );
      if (!res.ok) continue;
      const page = (await res.json()) as { type?: string; title?: string; originalimage?: { source: string; width: number }; thumbnail?: { source: string; width: number } };
      if (page.type === "disambiguation" || !wikipediaPageFits(entity, page.title ?? "")) {
        rejectImage("wikipedia", "rejected_candidate");
        continue;
      }
      const img = page.originalimage ?? page.thumbnail;
      if (!img || img.width < 500 || !/^https:\/\//.test(img.source) || /\.svg/i.test(img.source) || MAP_RE.test(img.source)) {
        rejectImage("wikipedia", "rejected_candidate");
        continue;
      }
      metric("wikipedia").accepted++;
      return img.source;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name !== "TimeoutError" && name !== "AbortError" && name !== "TypeError") rejectImage("wikipedia", "provider_error");
    }
  }
  return null;
}

async function findHdImage(term: string, used: Set<string>, description = ""): Promise<string[]> {
  if (!term.trim()) return [];
  const queries = imageSearchTerms(term, description);
  if (!queries.length) { rejectImage("search", "no_specific_terms"); return []; }
  const found: string[] = [];
  const entity = storyEntities(term, description)[0];
  if (entity) {
    const portrait = await fromWikipedia(entity);
    if (portrait && !imageAlreadyUsed(used, portrait)) {
      rememberImage(used, portrait);
      found.push(portrait);
      return found;
    }
  }
  const providers: [string, (query: string, used: Set<string>, storyTitle: string, description: string) => Promise<string | null>][] = [
    ["wikimedia", fromWikimediaCommons],
    ["openverse", fromOpenverse],
  ];
  if (entity) providers.push(["pexels", fromPexels], ["unsplash", fromUnsplash], ["pixabay", fromPixabay]);
  for (const query of queries.slice(0, 2)) {
    for (const [service, provider] of providers) {
      if (found.length >= 3) return found;
      try {
        const img = await provider(query, used, term, description);
        if (img) found.push(img);
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name !== "TimeoutError" && name !== "AbortError" && name !== "TypeError") rejectImage(service, "provider_error");
      }
    }
    if (found.length) return found;
  }
  return found;
}

export async function runIngest(): Promise<Record<string, unknown>> {
  return imageMetricsStore.run({}, () => runIngestWithMetrics());
}

async function runIngestWithMetrics(): Promise<Record<string, unknown>> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const started = Date.now();
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
        const articleText = await scrapeArticleText(n.url).catch(() => null);
        let g: Awaited<ReturnType<typeof generateGroqOne>> = null;
        groqAttempts++;
        try { g = await generateGroqOne(n.title, articleText); } catch { /* tenta a seguinte */ }
        if (!g) { cloudflareAttempts++; try { g = await generateCloudflareOne(n.title, articleText); } catch { /* entra na mesma */ } }
        if (!g) { nvidiaAttempts++; try { g = await generateNvidiaOne(n.title, articleText); } catch { /* entra na mesma */ } }
        if (!g) { geminiAttempts++; try { g = await generateOne(n.title, articleText); } catch { /* tenta a seguinte */ } }
        if (!g) { openrouterAttempts++; try { g = await generateOpenRouterOne(n.title, articleText); } catch { /* entra na mesma */ } }
        const ai = g && validTitle(g.titulo, n.title);
        const titulo = ai && isPublishableTitle(ai, n.title) ? ai : backupTitle(n.title);
        if (!titulo) return null;
        return { n, titulo, resumo: g?.resumo || n.excerpt?.trim() || titulo };
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
        const safeImage = storyImageUrl(rawImage);
        const sameStory = [...new Set((n.imageCandidates ?? []).map((candidate) => storyImageUrl(candidate)).filter((candidate): candidate is string => Boolean(candidate) && candidate !== safeImage))].slice(0, 4);
        const row = {
          id: n.id,
          source: (n.source || "Lusa").slice(0, 120),
          category,
          url: n.url.slice(0, 2000),
          image: safeImage,
          image_status: safeImage ? "original" : "provisional",
          image_candidates: sameStory,
          image_query: safeImage ? null : `${n.title} ${n.excerpt ?? ""}`.trim().slice(0, 500),
          original_title: n.title.slice(0, 500),
          titulo_inedito: titulo.slice(0, 180),
          resumo: resumo.slice(0, 300),
          relevance: relevance100(n),
          published_at: n.publishedAt,
        };
        let { error } = await db.from("articles").insert(row);
        if (error && error.code !== "23505" && /image_status|image_candidates/i.test(error.message)) {
          const { image_status: _status, image_candidates: _candidates, ...legacy } = row;
          const again = await db.from("articles").insert(legacy);
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
      const { data: recentImages } = await db.from("articles").select("image").not("image", "is", null).order("published_at", { ascending: false }).limit(80);
      for (const row of recentImages ?? []) if (row.image) rememberImage(used, row.image);
      const { data: missing } = await db.from("articles").select("id,url,image_query,original_title,resumo,category,titulo_inedito").not("image_query", "is", null).order("published_at", { ascending: false }).limit(6);
      await Promise.all((missing ?? []).map(async (m) => {
        const term = (m.original_title ?? m.titulo_inedito ?? "").trim();
        const description = [m.titulo_inedito, m.resumo, m.image_query].filter(Boolean).join(" ").trim();
        try {
          const articleImage = await fromArticlePage(m.url);
          const isRadio = /antena|radio/i.test(m.url) || /rtp.*antena/i.test(m.url);
          const found = articleImage && !isRadio ? [articleImage] : isRadio ? [await imageFromSameStory(term)].filter(Boolean) : await findHdImage(term, used, description);
          const safeFound = [...new Set(found.map((candidate) => storyImageUrl(candidate)).filter((candidate): candidate is string => Boolean(candidate)))];
          const img = safeFound[0];
          if (!img) {
            rejectImage(articleImage ? "article" : "search", "rejected_candidate");
            await db.from("articles").update({ image_query: null }).eq("id", m.id);
            return;
          }
          const saved = await db.from("articles").update({ image: img, image_status: articleImage ? "original" : "search", image_candidates: safeFound.slice(1, 5), image_query: null }).eq("id", m.id);
          if (saved.error && /image_status|image_candidates/i.test(saved.error.message)) {
            await db.from("articles").update({ image: img, image_query: null }).eq("id", m.id);
          }
        } catch { /* a próxima atualização tenta outra vez */ }
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
      const { data: recent } = await db.from("articles").select("id, original_title, titulo_inedito").order("published_at", { ascending: false }).limit(40);
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
        if (!next || swapsStoryActor(next, row.original_title)) next = backupTitle(row.original_title);
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

    const bag = imageMetricsStore.getStore() ?? {};
    const runId = crypto.randomUUID();
    const imageMetricsRows = Object.entries(bag).map(([service, value]) => ({
      service, requests: value.requests, results_found: value.resultsFound, accepted: value.accepted,
      failures: value.failures, latency_ms: value.latencyMs, rejection_reasons: value.rejectionReasons, run_id: runId,
    }));
    let metricsPersist: "ok" | "metrics_persist_failed" | "no_metrics" = imageMetricsRows.length ? "ok" : "no_metrics";
    if (imageMetricsRows.length) {
      const { error: metricsError } = await db.from("image_api_metrics").insert(imageMetricsRows);
      if (metricsError) {
        metricsPersist = "metrics_persist_failed";
        console.error("image_api_metrics_write_failed", metricsError.code ?? "unknown");
      }
    }
    return { inserted, pending: pending.length, saveError, geminiAttempts, groqAttempts, openrouterAttempts, nvidiaAttempts, cloudflareAttempts, rewritten, recategorized, imageMetrics: imageMetricsRows, metricsPersist, imageMetricsRunId: runId };
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
