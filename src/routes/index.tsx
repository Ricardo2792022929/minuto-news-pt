import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, ChevronDown, Loader2 } from "lucide-react";
import { getNews, type GetNewsResult } from "@/lib/news.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ao Minuto — Notícias de Portugal em direto" },
      {
        name: "description",
        content:
          "Feed infinito com as últimas notícias de Portugal e do mundo, atualizadas ao minuto: política, economia, desporto, cultura e muito mais.",
      },
      { property: "og:title", content: "Ao Minuto — Notícias de Portugal em direto" },
      {
        property: "og:description",
        content:
          "Feed infinito com as últimas notícias de Portugal e do mundo, atualizadas ao minuto: política, economia, desporto, cultura e muito mais.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const CATEGORIES = [
  "Tudo",
  "Política",
  "Economia",
  "Desporto",
  "Mundo",
  "Cultura",
  "Tech",
] as const;

type Category = (typeof CATEGORIES)[number];

const PAGE_SIZE = 10;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatClock(d: Date) {
  return d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(d: Date) {
  return d.toLocaleDateString("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "Agora";
  if (mins < 60) return `Há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Há ${hours} h`;
  const days = Math.round(hours / 24);
  return `Há ${days} dia${days > 1 ? "s" : ""}`;
}

function SaveButton({
  saved,
  onClick,
}: {
  saved: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-feed-fg transition-transform active:scale-90"
      aria-label={saved ? "Remover dos guardados" : "Guardar"}
    >
      <span
        className={`flex size-11 items-center justify-center rounded-full backdrop-blur-sm ${
          saved ? "animate-heart-pop bg-live text-live-foreground" : "bg-feed-fg/15"
        }`}
      >
        <Bookmark className={`size-6 ${saved ? "fill-live-foreground" : ""}`} />
      </span>
      <span className="text-[11px] font-semibold drop-shadow">
        {saved ? "Guardado" : "Guardar"}
      </span>
    </button>
  );
}

function FeedImage({
  src,
  alt,
  eager,
}: {
  src: string;
  alt: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={1024}
      height={1024}
      loading={eager ? "eager" : "lazy"}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-cover"
    />
  );
}

function Index() {
  const now = useClock();
  const [category, setCategory] = useState<Category>("Tudo");
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchNews = useServerFn(getNews);

  const query = useInfiniteQuery({
    queryKey: ["news", category],
    queryFn: ({ pageParam }) =>
      fetchNews({ data: { offset: pageParam, limit: PAGE_SIZE, category: category === "Tudo" ? undefined : category } }) as Promise<GetNewsResult>,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined,
  });

  // Página seguinte: offset = nº de itens já carregados (sem duplicados)
  const articles = useMemo(() => {
    const seen = new Set<string>();
    const list: GetNewsResult["items"] = [];
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        list.push(item);
      }
    }
    return list;
  }, [query.data]);

  const loadMore = useCallback(() => {
    if (query.isFetchingNextPage || !query.hasNextPage) return;
    query.fetchNextPage();
  }, [query]);

  const queryRef = useRef(query);
  queryRef.current = query;
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { root: feedRef.current, rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [category]);

  // Refresca a cada 2 minutos para acompanhar o direto
  useEffect(() => {
    const id = setInterval(() => {
      queryRef.current.refetch();
    }, 120_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0 });
  }, [category]);

  const toggleSave = (id: string) => {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tickerItems = useMemo(
    () => articles.slice(0, 5).map((a) => `${a.source.toUpperCase()} · ${a.title}`),
    [articles],
  );

  const isLoading = query.isLoading;
  const isError = query.isError;

  return (
    <div className="relative mx-auto h-[100dvh] w-full max-w-xl overflow-hidden bg-feed-bg">
      {/* Feed */}
      <div
        ref={feedRef}
        className="h-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {articles.map((a, i) => {
          const fresh =
            Date.now() - new Date(a.publishedAt).getTime() < 60 * 60_000;
          return (
            <article
              key={a.id}
              className="relative h-[100dvh] w-full snap-start snap-always overflow-hidden"
            >
              {/* Background */}
              {a.image ? (
                <FeedImage src={a.image} alt={a.title} eager={i === 0} />
              ) : null}
              {!a.image && (
                <div
                  className={`absolute inset-0 ${
                    a.id.charCodeAt(1) % 2 === 0 ? "feed-grad-a" : "feed-grad-b"
                  }`}
                />
              )}
              <div className="absolute inset-0 feed-scrim" />

              {/* Fresh badge */}
              {fresh && (
                <span className="absolute left-4 top-[104px] z-10 rounded-md bg-live px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-live-foreground">
                  Última hora
                </span>
              )}

              {/* Save button */}
              <div className="absolute bottom-28 right-3 z-10 flex flex-col items-center">
                <SaveButton
                  saved={saved.has(a.id)}
                  onClick={() => toggleSave(a.id)}
                />
              </div>

              {/* Bottom story */}
              <div className="absolute inset-x-0 bottom-0 z-10 pr-20 pb-8 pl-4">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
                  <span className="text-live">{a.source}</span>
                  <span className="text-feed-fg/60">·</span>
                  <span className="text-feed-fg/80">{a.category}</span>
                </div>
                <h2 className="mt-1.5 font-display text-2xl font-bold leading-tight text-feed-fg text-balance drop-shadow-md">
                  {a.title}
                </h2>
                {a.excerpt && (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-feed-fg/85 text-pretty">
                    {a.excerpt}
                  </p>
                )}
                <p className="mt-2 text-xs font-medium text-feed-fg/70">
                  <span className="font-bold text-live">{timeAgo(a.publishedAt)}</span>{" "}
                  · {formatClock(new Date(a.publishedAt))}
                </p>
              </div>

              {/* Swipe hint on first card */}
              {i === 0 && (
                <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 animate-bounce text-feed-fg/70">
                  <ChevronDown className="size-6" />
                </div>
              )}
            </article>
          );
        })}

        {/* Loading state */}
        {isLoading && (
          <div className="flex h-[100dvh] w-full snap-start items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-feed-fg/70">
              <Loader2 className="size-8 animate-spin" />
              <span className="text-sm font-medium">A carregar notícias…</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {isError && !articles.length && (
          <div className="flex h-[100dvh] w-full snap-start items-center justify-center px-8 text-center">
            <p className="text-sm text-feed-fg/70">
              Não foi possível carregar as notícias. Tenta novamente dentro de
              instantes.
            </p>
          </div>
        )}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
      </div>

      {/* Top overlay: masthead + ticker + categories */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto max-w-xl">
        <div className="pointer-events-auto bg-gradient-to-b from-feed-bg/85 to-transparent px-4 pb-6 pt-4 backdrop-blur-[2px]">
          <div className="flex items-end justify-between">
            <h1 className="font-display text-3xl font-black tracking-tight text-feed-fg">
              Ao<span className="text-live">Minuto</span>
            </h1>
            <div className="flex items-center gap-2 pb-1">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-live-pulse rounded-full bg-live" />
                <span className="relative size-2 rounded-full bg-live" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-widest text-feed-fg/80">
                Em direto · {formatClock(now)}
              </span>
            </div>
          </div>
          <p className="mt-0.5 text-[11px] capitalize text-feed-fg/60">
            {formatDate(now)} · Lisboa
          </p>

          {/* Ticker */}
          {tickerItems.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-full bg-feed-fg/10 py-1.5 backdrop-blur-sm">
              <div className="flex w-max animate-ticker items-center whitespace-nowrap">
                {[...tickerItems, ...tickerItems].map((item, idx) => (
                  <span
                    key={idx}
                    className="px-4 text-[10px] font-semibold uppercase tracking-wide text-feed-fg/90"
                  >
                    {item}
                    <span className="pl-4 text-live">●</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Category pills */}
          <nav className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold backdrop-blur-sm transition-colors ${
                  category === c
                    ? "bg-live text-live-foreground"
                    : "bg-feed-fg/15 text-feed-fg hover:bg-feed-fg/25"
                }`}
              >
                {c}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
