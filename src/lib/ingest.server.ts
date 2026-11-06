import { AsyncLocalStorage } from "node:async_hooks";
import { getAllNews, relevanceScore, isLowResImage, classify } from "./news.server";
import { drainFailures, drainSamples, generateOne, GatewayError, recordSample, validTitle, isPublishableTitle, swapsStoryActor } from "./title-generation.server";
import { BATCH_PROVIDERS, askBatch } from "./title-batch.server";
import { generateGroqOne } from "./title-generation.groq.server";
import { generateOpenRouterOne } from "./title-generation.openrouter.server";
import { generateNvidiaOne } from "./title-generation.nvidia.server";
import { generateCloudflareOne } from "./title-generation.cloudflare.server";
import { scrapeArticleText } from "./article-scrape.server";
import { imageKitUrl } from "./imagekit";
import { storyImageUrl } from "./image-policy";
import { imageSearchTerms, storyEntities } from "./image-search.server";
import { cleanStoryTitle, imageAlreadyUsed, rememberImage, scoreCandidate, wikipediaPageFits } from "./image-relevance";
import { imageFromArticlePage, imageFromSameStory } from "./article-image.server";
import { adequateImage } from "./image-quality";
import { asLinks, mergeLinks, titlesMatch, type StoryLink } from "./story-match";
import type { Json } from "@/integrations/supabase/types";

const BATCH = 10;
const MAX_BATCHES = 8;
/* O cron-job.org corta a ligação por volta dos 30 s. As notícias novas têm de estar
   guardadas antes disso; o resto (imagens, reescritas, categorias) usa só o que sobrar. */
const BUDGET_MS = 20_000;
/** Chamadas que aguentam mais tempo (pg_cron do Supabase, GitHub) pedem `?budget=<segundos>`. */
export const MAX_BUDGET_MS = 100_000;
/** Notícias reescritas em paralelo; as IAs rodam, por isso o pedido não cai todo no mesmo serviço. */
/** Notícias por grupo e grupos em paralelo. Cada grupo é 1 pedido por IA (ou 2 nas IAs de lote curto). */
const GROUP_SIZE = 8;
const GROUPS_IN_PARALLEL = 3;
/** Notícia recusada por duas ou mais IAs: fica de fora durante 1 hora. Memória da instância do servidor. */
const FAIL_PAUSE_MS = 60 * 60_000;
const failedRecently = new Map<string, number>();

/* As colunas related, image_status e image_candidates e a tabela image_api_metrics existem na base
   (confirmado com o workflow ver-feed), mas não nos tipos gerados do Supabase. Este cliente sem tipos
   deixa usá-las sem erros de compilação, em vez de as retirar. */
type LooseError = { code?: string; message: string; hint?: string } | null;
type LooseResult = { data: unknown; error: LooseError };
type LooseQuery = PromiseLike<LooseResult> & {
  eq: (column: string, value: string) => LooseQuery;
  maybeSingle: () => PromiseLike<LooseResult>;
};
type LooseDb = {
  from: (table: string) => {
    insert: (values: unknown) => PromiseLike<LooseResult>;
    update: (values: unknown) => LooseQuery;
    select: (columns: string) => LooseQuery;
  };
};
const looseDb = (db: unknown) => db as LooseDb;

function batchSummary(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length < 20 || s.length > 300 || /[*_`#>\[\]]/.test(s)) return null;
  return s;
}

function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
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

export async function runIngest(options: { budgetMs?: number } = {}): Promise<Record<string, unknown>> {
  const asked = options.budgetMs;
  const budgetMs = asked && Number.isFinite(asked) ? Math.min(MAX_BUDGET_MS, Math.max(BUDGET_MS, Math.round(asked))) : BUDGET_MS;
  drainFailures();
  return imageMetricsStore.run({}, () => runIngestWithMetrics(budgetMs));
}

async function runIngestWithMetrics(budgetMs: number): Promise<Record<string, unknown>> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const loose = looseDb(db);
  let started = Date.now();
  // Com mais tempo, tudo ganha folga: recolha, cada título (contexto + todas as IAs) e manutenção.
  const longRun = budgetMs > BUDGET_MS;
  const collectMs = longRun ? 25_000 : 12_000;
  // O tempo de espera pelo bloqueio sai do orçamento, para não passar dos 120 s do pg_cron.
  let effectiveBudget = budgetMs;
  let maintenanceMs = budgetMs + (longRun ? 10_000 : 7_000);
  const expired = () => Date.now() - started > effectiveBudget;
  const maintenanceOver = () => Date.now() - started > maintenanceMs;
  const isLocked = async () => {
    const { data: current } = await db.from("ingest_state").select("id, locked_until").eq("id", 1).maybeSingle();
    const lockedUntil = current?.locked_until ? new Date(current.locked_until).getTime() : 0;
    return lockedUntil > Date.now() && lockedUntil < Date.now() + 4 * 60_000;
  };
  // Outra ronda a correr (por exemplo a do agendador do Lovable): nas rondas longas espera que acabe (até 60 s), em vez de perder esta.
  let waitedMs = 0;
  while (await isLocked()) {
    if (!longRun || waitedMs >= 60_000) return { skipped: "locked", waitedMs };
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    waitedMs += 5_000;
  }
  started = Date.now();
  effectiveBudget = Math.max(BUDGET_MS, budgetMs - waitedMs);
  maintenanceMs = effectiveBudget + (longRun ? 10_000 : 7_000);
  const nowIso = new Date().toISOString();
  const until = new Date(Date.now() + 3 * 60_000).toISOString();
  const { error: lockError } = await db.from("ingest_state").upsert(
    { id: 1, locked_until: until, updated_at: nowIso },
    { onConflict: "id" },
  );
  if (lockError) return { error: lockError.message };

  let inserted = 0;
  try {
    const cutoff = new Date(Date.now() - 72 * 3600_000).toISOString();
    await db.from("articles").delete().lt("published_at", cutoff);
    const news = (await withDeadline(getAllNews(), collectMs, [])).filter((n) => n.publishedAt >= cutoff).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    // Já guardadas: pergunta-se só pelas notícias desta recolha (aos bocados), em vez de ler a tabela.
    // Com mais de 1000 notícias em 72 h, o limite de 1000 linhas do Supabase deixava muitas de fora:
    // eram tratadas como novas, gastavam pedidos às IAs e no fim falhavam ao gravar (já existiam).
    const existing = new Set<string>();
    const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
    const newsIds = [...new Set(news.map((n) => n.id))];
    const newsUrls = [...new Set(news.map((n) => n.url.slice(0, 2000)))];
    await Promise.all([
      ...chunks(newsIds, 120).map(async (ids) => {
        const { data } = await db.from("articles").select("id").in("id", ids);
        for (const r of data ?? []) existing.add(r.id);
      }),
      ...chunks(newsUrls, 30).map(async (urls) => {
        const { data } = await db.from("articles").select("url").in("url", urls);
        for (const r of data ?? []) existing.add(normalizeArticleUrl(r.url));
      }),
    ]);
    // Títulos já guardados (para juntar a mesma notícia de outra fonte): as mais recentes primeiro, até 2000.
    const titleCols = "id, source, original_title, titulo_inedito";
    const titlePages = await Promise.all([0, 1].map((page) =>
      db.from("articles").select(titleCols).gte("published_at", cutoff).order("published_at", { ascending: false }).range(page * 1000, page * 1000 + 999),
    ));
    const savedRows = titlePages.flatMap((page) => page.data ?? []);
    const knownTitles = savedRows.flatMap((r) => [r.original_title, r.titulo_inedito]).filter((title): title is string => typeof title === "string" && title.trim().length > 0);
    const extras = new Map<string, StoryLink[]>();
    const addExtra = (id: string, extra: StoryLink) => {
      const list = extras.get(id) ?? [];
      extras.set(id, mergeLinks(list, [extra]));
    };
    const attach = (n: { id: string; source: string; title: string; url: string; publishedAt: string }) => {
      const extra: StoryLink = { source: n.source, title: n.title, url: n.url, publishedAt: n.publishedAt };
      const pendingHit = pending.find((item) => item.source !== n.source && titlesMatch(n.title, item.title));
      if (pendingHit) {
        addExtra(pendingHit.id, extra);
        return true;
      }
      const savedHit = savedRows.find((row) => row.source !== n.source && [row.original_title, row.titulo_inedito].some((title) => title && titlesMatch(n.title, title)));
      if (!savedHit) return false;
      addExtra(savedHit.id, extra);
      return true;
    };
    const desired = BATCH * MAX_BATCHES;
    const fallbackWindows = [60, 180, 360, 720, 1440];
    const fresh = news.filter((n) => !existing.has(n.id) && !existing.has(normalizeArticleUrl(n.url)));
    const lusaPick: typeof news = [];
    for (const n of fresh) {
      if (n.source !== "Lusa" || lusaPick.length >= 4) continue;
      if (hasSimilarTitle(n.title, lusaPick.map((item) => item.title))) continue;
      lusaPick.push(n);
      knownTitles.push(n.title);
    }
    const lusaIds = new Set(lusaPick.map((n) => n.id));
    const candidates = fresh.filter((n) => !lusaIds.has(n.id) && !hasSimilarTitle(n.title, knownTitles));
    const pending: typeof news = [...lusaPick];
    const selected = new Set<string>(lusaIds);
    const addWindow = (olderThanMinutes: number, newerThanMinutes: number) => {
      for (const n of candidates) {
        const ageMinutes = (Date.now() - new Date(n.publishedAt).getTime()) / 60_000;
        if (ageMinutes < olderThanMinutes || ageMinutes >= newerThanMinutes || selected.has(n.id)) continue;
        if (hasSimilarTitle(n.title, knownTitles)) {
          attach(n);
          continue;
        }
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
    for (const n of fresh) {
      if (selected.has(n.id)) continue;
      if (hasSimilarTitle(n.title, knownTitles)) attach(n);
    }
    pending.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

    const used = new Set<string>();
    let geminiAttempts = 0, groqAttempts = 0, openrouterAttempts = 0, nvidiaAttempts = 0, cloudflareAttempts = 0;
    let saveError: string | null = null;
    let rewritten = 0;
    const freshNews: { title: string; url: string; publishedAt: string; image?: string | null }[] = [];
    const queue = pending.slice(0, 80);
    // Diagnóstico: porque é que as IAs não deram título (contagens e alguns exemplos).
    const rejectCounts: Record<string, number> = {};
    const rejectSamples: { api: string; motivo: string; original: string; recebido?: string }[] = [];
    const noteReject = (api: string, motivo: string, original: string, recebido?: string) => {
      const key = `${api}: ${motivo}`;
      rejectCounts[key] = (rejectCounts[key] ?? 0) + 1;
      if (rejectSamples.length < 8) rejectSamples.push({ api, motivo, original: original.slice(0, 90), ...(recebido ? { recebido: recebido.slice(0, 90) } : {}) });
    };
    const saveOne = async (item: { n: (typeof queue)[number]; titulo: string; resumo: string }) => {
      const { n, titulo, resumo } = item;
      const category = classify(`${cleanStoryTitle(n.title)} ${n.excerpt ?? ""}`, n.category || "Mundo");
      const picked = (() => { const url = n.image || n.imageCandidates?.[0] || null; return url ? { url, status: "original" as const } : null; })();
      const rawImage = picked?.url ?? null;
      const safeImage = storyImageUrl(rawImage, false);
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
        related: (extras.get(n.id) ?? []) as Json,
      };
      let { error } = await loose.from("articles").insert(row);
      if (error && error.code !== "23505" && /related/i.test(error.message)) {
        const { related: _related, ...withoutRelated } = row;
        error = (await loose.from("articles").insert(withoutRelated)).error;
      }
      if (error && error.code !== "23505" && /image_status|image_candidates/i.test(error.message)) {
        const { related: _r, image_status: _status, image_candidates: _candidates, ...legacy } = row;
        error = (await loose.from("articles").insert(legacy)).error;
      }
      if (error) {
        if (error.code === "23505") return;
        saveError ??= `${error.code ?? ""} ${error.message}${error.hint ? ` (${error.hint})` : ""}`.trim();
        return;
      }
      inserted++;
      freshNews.push({ title: titulo, url: n.url, publishedAt: n.publishedAt, image: safeImage });
    };
    // Títulos em lote: grupos de 8 notícias (mais recentes primeiro). Cada grupo passa pelas IAs por ordem;
    // cada IA recebe as que ainda faltam num só pedido. O que volta passa pelas regras, um a um.
    const attempts: Record<string, number> = {};
    let skippedByMemory = 0;
    const work = queue.filter((n) => {
      const until = failedRecently.get(n.id) ?? 0;
      if (until > Date.now()) { skippedByMemory++; return false; }
      return true;
    });
    const groups: (typeof queue)[] = [];
    for (let i = 0; i < work.length; i += GROUP_SIZE) groups.push(work.slice(i, i + GROUP_SIZE));
    const titleGroup = async (group: typeof queue) => {
      const texts = await Promise.all(group.map((n) => (expired() ? null : scrapeArticleText(n.url).catch(() => null))));
      let left = group.map((n, i) => ({ n, articleText: texts[i] ?? null, responses: 0 }));
      let reachedEnd = true;
      for (const provider of BATCH_PROVIDERS) {
        if (!left.length) break;
        if (expired()) { reachedEnd = false; break; }
        const done = new Set<string>();
        for (let i = 0; i < left.length; i += provider.size) {
          if (expired()) { reachedEnd = false; break; }
          const chunk = left.slice(i, i + provider.size);
          attempts[provider.api] = (attempts[provider.api] ?? 0) + 1;
          const timeLeftMs = effectiveBudget - (Date.now() - started) + 5_000;
          const { responded, answers } = await askBatch(provider, chunk.map((x) => ({ title: x.n.title, articleText: x.articleText })), timeLeftMs);
          for (let k = 0; k < chunk.length; k++) {
            const slot = chunk[k];
            if (!slot) continue;
            const { n, articleText } = slot;
            if (responded) slot.responses++;
            const got = answers.get(k + 1);
            if (!got) { noteReject(provider.api, responded ? "faltou no lote" : "vazio", n.title); continue; }
            const candidate = validTitle(got.titulo, n.title, articleText);
            if (!candidate) {
              noteReject(provider.api, "título recusado", n.title, typeof got.titulo === "string" ? got.titulo : undefined);
              recordSample(provider.api, got.titulo);
              continue;
            }
            if (!isPublishableTitle(candidate, n.title, articleText)) { noteReject(provider.api, "não publicável", n.title, candidate); continue; }
            done.add(n.id);
            await saveOne({ n, titulo: candidate, resumo: batchSummary(got.resumo) || n.excerpt?.trim() || candidate });
          }
        }
        left = left.filter((x) => !done.has(x.n.id));
      }
      // Recusada por pelo menos duas IAs que responderam: fica de fora durante um tempo, em vez de gastar pedidos em todas as rondas.
      if (reachedEnd) for (const x of left) if (x.responses >= 2) failedRecently.set(x.n.id, Date.now() + FAIL_PAUSE_MS);
    };
    let nextGroup = 0;
    const groupWorker = async () => {
      while (!expired()) {
        const i = nextGroup++;
        if (i >= groups.length) return;
        const group = groups[i];
        if (!group) return;
        await titleGroup(group);
      }
    };
    await Promise.all(Array.from({ length: GROUPS_IN_PARALLEL }, () => groupWorker()));
    for (const [id, until] of failedRecently) if (until <= Date.now()) failedRecently.delete(id);
    groqAttempts = attempts["groq"] ?? 0;
    geminiAttempts = attempts["gemini"] ?? 0;
    cloudflareAttempts = attempts["cloudflare"] ?? 0;
    openrouterAttempts = attempts["openrouter"] ?? 0;
    nvidiaAttempts = attempts["nvidia"] ?? 0;

    // Outras fontes da mesma notícia, já guardada numa ronda anterior: juntam-se às ligações dela.
    const touched = new Set(queue.map((item) => item.id));
    for (const [id, list] of extras) {
      if (!list.length || touched.has(id)) continue;
      const { data: current, error: readError } = await loose.from("articles").select("related").eq("id", id).maybeSingle();
      if (readError) break;
      const previous = current && typeof current === "object" ? (current as { related?: unknown }).related : undefined;
      const merged = mergeLinks(asLinks(previous), list);
      const { error: writeError } = await loose.from("articles").update({ related: merged as Json }).eq("id", id);
      if (writeError) break;
    }

    // Aviso logo a seguir a guardar, antes da manutenção: se a ligação cair, não se perde.
    let push: "sent" | "none" | "no-key" | "rejected" | "error" = "none";
    try {
      const { notifyImportant } = await import("./push.server");
      push = await notifyImportant(freshNews);
    } catch {
      push = "error";
    }

    // Enriquecer as que ainda não têm imagem
    let recategorized = 0;
    if (!maintenanceOver()) {
      const { data: recentImages } = await db.from("articles").select("image").not("image", "is", null).order("published_at", { ascending: false }).limit(80);
      for (const row of recentImages ?? []) if (row.image) rememberImage(used, row.image);
      const { data: missing } = await db.from("articles").select("id,url,image_query,original_title,resumo,category,titulo_inedito").not("image_query", "is", null).order("published_at", { ascending: false }).limit(20);
      await Promise.all((missing ?? []).map(async (m) => {
        const term = (m.original_title ?? m.titulo_inedito ?? "").trim();
        const description = [m.titulo_inedito, m.resumo, m.image_query].filter(Boolean).join(" ").trim();
        try {
          const articleImage = await fromArticlePage(m.url);
          const isRadio = /antena|radio/i.test(m.url) || /rtp.*antena/i.test(m.url);
          const isLogoImage = articleImage && /logo|ojogo|o-jogo|favicon|brand/i.test(articleImage);
          let found: string[] = [];
          let status: "original" | "search" = "original";
          if (articleImage && !isRadio && !isLogoImage) found = [articleImage];
          else {
            const sameStory = await imageFromSameStory(term);
            if (sameStory) found = [sameStory];
            else {
              found = await findHdImage(term, used, description);
              status = "search";
            }
          }
          const safeFound = [...new Set(found.map((candidate) => storyImageUrl(candidate, status === "search")).filter((candidate): candidate is string => Boolean(candidate)))];
          const img = safeFound[0];
          if (!img) {
            rejectImage(articleImage ? "article" : "search", "rejected_candidate");
            await db.from("articles").update({ image_query: null }).eq("id", m.id);
            return;
          }
          const saved = await loose.from("articles").update({ image: img, image_status: status, image_candidates: safeFound.slice(1, 5), image_query: null }).eq("id", m.id);
          if (saved.error && /image_status|image_candidates/i.test(saved.error.message)) {
            await db.from("articles").update({ image: img, image_query: null }).eq("id", m.id);
          }
        } catch { /* a próxima atualização tenta outra vez */ }
      }));
    }

    if (!maintenanceOver()) {
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

    if (!maintenanceOver()) {
      const { data: recent } = await db.from("articles").select("id, original_title, titulo_inedito, resumo").order("published_at", { ascending: false }).limit(80);
      for (const row of recent ?? []) {
        if (maintenanceOver() || rewritten >= 24) break;
        if (!row.original_title || !row.titulo_inedito) continue;
        if (isPublishableTitle(row.titulo_inedito, row.original_title)) continue;
        let next: string | null = null;
        let resumo: string | null = null;
        try {
          const groq = await generateGroqOne(row.original_title, null);
          next = groq?.titulo ?? null;
          resumo = groq?.resumo ?? null;
        } catch { /* tenta a seguinte */ }
        if (!next) {
          try {
            const cloudflare = await generateCloudflareOne(row.original_title, null);
            next = cloudflare?.titulo ?? null;
            resumo = cloudflare?.resumo ?? resumo;
          } catch { /* ignora */ }
        }
        if (!next) {
          try {
            const nvidia = await generateNvidiaOne(row.original_title, null);
            next = nvidia?.titulo ?? null;
            resumo = nvidia?.resumo ?? resumo;
          } catch { /* ignora */ }
        }
        if (!next) {
          try {
            const gemini = await generateOne(row.original_title, null);
            next = gemini?.titulo ?? null;
            resumo = gemini?.resumo ?? resumo;
          } catch { /* tenta a seguinte */ }
        }
        if (!next) {
          try {
            const openrouter = await generateOpenRouterOne(row.original_title, null);
            next = openrouter?.titulo ?? null;
            resumo = openrouter?.resumo ?? resumo;
          } catch { /* ignora */ }
        }
        if (!next || !isPublishableTitle(next, row.original_title) || swapsStoryActor(next, row.original_title)) continue;
        const patch: { titulo_inedito: string; resumo?: string } = { titulo_inedito: next };
        if (resumo) patch.resumo = resumo.slice(0, 300);
        const { error } = await db.from("articles").update(patch).eq("id", row.id);
        if (!error) rewritten++;
      }
    }

    if (!maintenanceOver()) {
      const { data: tagged } = await db
        .from("articles")
        .select("id, original_title, titulo_inedito, resumo, category")
        .order("published_at", { ascending: false })
        .limit(800);
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
      const { error: metricsError } = await loose.from("image_api_metrics").insert(imageMetricsRows);
      if (metricsError) {
        metricsPersist = "metrics_persist_failed";
        console.error("image_api_metrics_write_failed", metricsError.code ?? "unknown");
      }
    }
    return { inserted, pending: pending.length, lusaQueued: lusaPick.length, saveError, geminiAttempts, groqAttempts, openrouterAttempts, nvidiaAttempts, cloudflareAttempts, rewritten, recategorized, imageMetrics: imageMetricsRows, metricsPersist, imageMetricsRunId: runId, push, rejectCounts, rejectSamples, falhas: drainFailures(), recusados: drainSamples(), emLote: true, saltadasPorMemoria: skippedByMemory, esperouMs: waitedMs };
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
