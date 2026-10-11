import { getAllNews, relevanceScore, isLowResImage } from "./news.server";
import { generateOne, GatewayError } from "./title-generation.server";
import { generateGroqOne } from "./title-generation.groq.server";
import { finalImageUrl } from "./image-policy";
import { inspectImage } from "./image-dimensions.server";
import { adequateImage } from "./image-quality";

const BATCH = 4; // concorrência moderada para evitar picos de pedidos às APIs
const MAX_BATCHES = 10; // até 40 notícias por ciclo; ciclos frequentes mantêm o feed atualizado

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
const PIXABAY_CACHE_TTL = 20 * 60 * 60_000; // URLs do Pixabay expiram ao fim de 24h
const pixabayCache = new Map<string, { expiresAt: number; hits: Hit[] }>();
async function fromPixabay(term: string, used: Set<string>) {
  const key = process.env["PIXABAY_API_KEY"] || process.env["PIXABAY_KEY"];
  if (!key || !term) return null;
  const k = term.toLowerCase();
  const cached = pixabayCache.get(k);
  let hits = cached && cached.expiresAt > Date.now() ? cached.hits : undefined;
  if (!hits) {
    const params = new URLSearchParams({
      key,
      q: term.slice(0, 100),
      lang: "pt",
      image_type: "photo",
      orientation: "horizontal",
      min_width: "800",
      min_height: "600",
      safesearch: "true",
      per_page: "20",
    });
    const res = await fetch(
      `https://pixabay.com/api/?${params.toString()}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null; // quota/erro: continua com as outras fontes
    const d = (await res.json()) as { hits?: { webformatURL: string; largeImageURL?: string; imageURL?: string; fullHDURL?: string; imageWidth: number; imageHeight: number; tags: string }[] };
    // só aceita resultados cujas etiquetas partilhem uma palavra com o termo (evita correspondências inventadas)
    const words = k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\W+/).filter((w) => w.length > 3 && !["para", "como", "mais", "sobre", "apos", "hoje", "anuncia", "portugal", "portugues", "noticias"].includes(w));
    hits = (d.hits ?? [])
      .filter((h) => { const tags = h.tags.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\W+/); return words.some((w) => tags.includes(w)) && adequateImage({ width: h.imageWidth, height: h.imageHeight }); })
      // webformatURL é a URL de exibição temporária documentada pelo Pixabay;
      // as notícias são retidas por 24h e esta cache expira antes desse prazo.
      .map((h) => ({ url: h.webformatURL, width: h.imageWidth, text: h.tags }));
    pixabayCache.set(k, { hits, expiresAt: Date.now() + PIXABAY_CACHE_TTL });
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
  for (const fn of [fromUnsplash, fromPexels, fromOpenverse, fromPixabay]) {
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
    // só artigos das últimas 24h, mais recentes primeiro; não há limite global de arquivo.
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
    const desired = BATCH * MAX_BATCHES;
    const fallbackWindows = [60, 180, 360, 720, 1440]; // minutos desde agora
    const candidates = news.filter((n) =>
      !existing.has(n.id) && !existing.has(normalizeArticleUrl(n.url)) && !hasSimilarTitle(n.title, knownTitles),
    );
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

    // A ingestão principal usa primeiro imagens dos feeds; as restantes são enriquecidas
    // em paralelo após a gravação, para não bloquear a publicação das notícias.
    const used = new Set<string>();

    // Gemini é primário e Groq é fallback sequencial. Cooldowns por processo evitam
    // repetir pedidos a provedores que respondem com 429/erros de autenticação.
    let geminiAttempts = 0;
    let groqAttempts = 0;
    for (let offset = 0; offset < pending.length; offset += BATCH) {
      const batch = pending.slice(offset, offset + BATCH);
      const results = await Promise.all(batch.map(async (n) => {
        geminiAttempts++;
        // Uma chamada de cada vez por notícia: Gemini primeiro, Groq apenas como fallback.
        // Limita picos de tráfego e evita gastar duas quotas quando a primeira API responde bem.
        let g: Awaited<ReturnType<typeof generateOne>> = null;
        try {
          g = await generateOne(n.title);
        } catch (error) {
          console.warn("Gemini falhou; a tentar Groq", error instanceof Error ? error.message : error);
        }
        if (!g) {
          groqAttempts++;
          try {
            g = await generateGroqOne(n.title);
          } catch (error) {
            console.warn("Groq falhou", error instanceof Error ? error.message : error);
          }
        }
        if (!g) {
          // Se ambas as APIs estiverem limitadas/indisponíveis, não perder a notícia:
          // usa o título e o resumo do feed, sem inventar informação.
          const sourceTitle = n.title.trim();
          if (!sourceTitle) return 0;
          g = {
            titulo: sourceTitle.slice(0, 180),
            resumo: (n.excerpt?.trim() || sourceTitle).slice(0, 300),
          };
          console.warn("Publicado com título original: Gemini e Groq indisponíveis/limitados", n.source);
        }
        try {
          // Não bloquear a ingestão à procura de imagens externas. Usar apenas imagem do feed;
          // as notícias sem imagem podem ser enriquecidas pelo processo de recuperação abaixo.
          const image = (n.imageCandidates ?? (n.image ? [n.image] : []))
            .find((url) => url && !isLowResImage(url)) ?? null;
          const image_query: string | null = image ? null : g.titulo;
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

    // Corrige também artigos que receberam a foto genérica de categoria: image_query
    // assinala que ainda falta uma imagem específica. Antes, filtrar image IS NULL
    // nunca os apanhava porque finalImageUrl já devolvia uma imagem genérica.
    // A página original é prioritária; depois tenta bancos de fotografias e deixa Pixabay como último recurso.
    const { data: missing } = await db
      .from("articles")
      .select("id,url,image_query,category,titulo_inedito")
      .not("image_query", "is", null)
      .limit(8);
    await Promise.all((missing ?? []).map(async (m) => {
      const term = (m.image_query ?? m.titulo_inedito ?? "").trim();
      try {
        const img = (await fromArticlePage(m.url)) ?? (await findHdImage(term, used));
        if (!img) return;
        const { error } = await db.from("articles")
          .update({ image: finalImageUrl(img, m.category, m.titulo_inedito), image_query: null })
          .eq("id", m.id);
        if (error) console.warn("não foi possível guardar imagem", m.id, error.message);
      } catch (error) {
        console.warn("enriquecimento de imagem falhou", m.id, error instanceof Error ? error.message : error);
      }
    }));

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
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
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
