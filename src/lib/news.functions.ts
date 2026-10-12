import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NewsItem } from "./news.types";
import { finalImageUrl, guaranteedImage } from "./image-policy";

const SHOCK = [
  "morre", "morreu", "morto", "mortos", "mata", "matou", "assassin", "vitima", "tragedia",
  "ataque", "guerra", "bomba", "explos", "tiroteio", "missile", "missil",
  "detid", "preso", "prisao", "crime", "assalt", "roubo", "homicid", "rapto",
  "incendio", "sismo", "terramoto", "inund", "tempestade", "catastrof", "acidente", "despiste",
  "escandalo", "corrup", "fraude", "burla", "choque", "alerta", "urgente", "caos", "crise", "colaps",
  "demite", "demissao", "golpe", "ameaca", "sancao", "sancoes",
  "ucrania", "gaza", "israel", "putin", "trump", "zelensky", "irao", "russia",
  "greve", "desab", "explod", "queda de",
];
const SOFT = ["benfica", "sporting", "ronaldo", "golo", "derrota", "lesao", "champions"];
const DULL = [
  "horoscopo", "receita", "concerto", "exposicao", "orquestra", "inaugur", "freguesia",
  "ecopista", "passatempo", "publicidade", "podcast", "review", "beneficiacao",
  "agenda", "festival", "teatro", "livro",
];

function plain(title: string): string {
  return title.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function hit(text: string, word: string): boolean {
  if (word.length >= 6) return text.includes(word);
  return new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(text);
}

/** Só entra no meio do feed se for relevante e um pouco chocante. */
function shockScore(title: string): number {
  const t = plain(title);
  let score = 0;
  for (const word of SHOCK) if (hit(t, word)) score += 3;
  for (const word of SOFT) if (hit(t, word)) score += 1;
  for (const word of DULL) if (t.includes(word)) score -= 6;
  return score;
}

// Lê apenas notícias já pré-processadas (com título final pronto) da base de dados.
export const getNews = createServerFn({ method: "GET" })
  .validator(
    (data) =>
      z
        .object({
          offset: z.number().min(0).default(0),
          limit: z.number().min(1).max(50).default(12),
          category: z.string().optional(),
          interests: z.array(z.string()).optional(),
        })
        .parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<GetNewsResult> => {
    const url = process.env["SUPABASE_URL"]!;
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const db = createClient(url, key, {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });

    const now = Date.now();
    const cols = "id,source,category,url,image,titulo_inedito,resumo,published_at";
    const toItem = (r: {
      id: string;
      source: string;
      category: string;
      url: string;
      image: string | null;
      titulo_inedito: string;
      resumo: string | null;
      published_at: string;
    }): NewsItem => ({
      id: r.id,
      source: r.source,
      category: r.category,
      title: r.titulo_inedito,
      excerpt: (r.resumo ?? "").trim(),
      url: r.url,
      publishedAt: r.published_at,
      image: finalImageUrl(r.image, r.category, r.titulo_inedito, r.id) || guaranteedImage(r.id, r.category),
    });

    // Mais recentes primeiro. A atualização habitual não muda.
    let q = db
      .from("articles")
      .select(cols, { count: "exact" })
      .gte("published_at", new Date(now - 24 * 3600_000).toISOString())
      .order("published_at", { ascending: false })
      .order("id", { ascending: true })
      .range(0, Math.min(data.offset + data.limit + 60, 1000) - 1);
    if (data.category) q = q.eq("category", data.category);
    const { data: rows, error, count } = await q;
    if (error) {
      console.error(error);
      return { items: [], total: 0, hasMore: false, nextOffset: data.offset };
    }
    const total = count ?? 0;
    const ordered = (rows ?? []).map(toItem).sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    const fresh = ordered.slice(data.offset, data.offset + data.limit);

    // Do dia, até 24 horas, mas só as fortes. O fio das mais recentes não pára.
    const daySince = new Date(now - 24 * 3600_000).toISOString();
    const dayUntil = new Date(now - 90 * 60_000).toISOString();
    const loadDay = async (onlyInterests: boolean) => {
      let oq = db
        .from("articles")
        .select(cols)
        .gte("published_at", daySince)
        .lte("published_at", dayUntil)
        .order("published_at", { ascending: false })
        .limit(80);
      if (data.category) oq = oq.eq("category", data.category);
      else if (onlyInterests && data.interests && data.interests.length) oq = oq.in("category", data.interests);
      const { data: dayRows } = await oq;
      return (dayRows ?? []).map(toItem).filter((item) => shockScore(item.title) >= 3);
    };
    let day = await loadDay(true);
    if (day.length < 4 && !data.category) day = await loadDay(false);
    day.sort((a, b) => shockScore(b.title) - shockScore(a.title) || +new Date(b.publishedAt) - +new Date(a.publishedAt));
    const byCategory = new Map<string, NewsItem[]>();
    for (const item of day) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }
    const diversified: NewsItem[] = [];
    const buckets = [...byCategory.values()];
    let pending = true;
    while (pending) {
      pending = false;
      for (const bucket of buckets) {
        const next = bucket.shift();
        if (next) {
          diversified.push(next);
          pending = true;
        }
      }
    }
    const page = Math.floor(data.offset / data.limit);
    const pool = diversified.slice(page * 4);
    const seen = new Set(fresh.map((item) => item.id));
    const titleKey = (title: string) => plain(title).split(/\s+/).slice(0, 6).join(" ");
    const freshTitles = new Set(fresh.map((item) => titleKey(item.title)));
    const mixed: NewsItem[] = [];
    let dayIndex = 0;
    fresh.forEach((item, index) => {
      mixed.push(item);
      // Duas novas, depois uma forte do dia. Equilibrado, sem parar as atualizações.
      if ((index + 1) % 2 !== 0) return;
      while (dayIndex < pool.length) {
        const candidate = pool[dayIndex];
        dayIndex += 1;
        if (!candidate || seen.has(candidate.id) || freshTitles.has(titleKey(candidate.title))) continue;
        seen.add(candidate.id);
        mixed.push(candidate);
        break;
      }
    });

    const nextOffset = data.offset + data.limit;
    return { items: mixed, total, hasMore: nextOffset < total, nextOffset };
  });

export type GetNewsResult = {
  items: NewsItem[];
  total: number;
  hasMore: boolean;
  nextOffset?: number;
};
