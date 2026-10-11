import { createFileRoute } from "@tanstack/react-router";
import introUrl from "@/assets/intro.mp4";
import { excessiveEnlargement } from "@/lib/image-quality";
import { categoryImage } from "@/lib/image-policy";

// Banco de FOTOGRAFIAS REAIS (Wikimedia Commons) por tema — usado só quando a
// notícia não tem foto ou a foto falha. Garante que nenhum cartão fica preto.
const WM = (path: string) => `https://upload.wikimedia.org/wikipedia/commons/${path}`;
const REAL_POOL: Record<string, string[]> = {
  Crime: [
    WM("4/4c/Police_car_lights.jpg"),
    WM("3/3d/Police_Lights.jpg"),
    WM("f/f0/2009-04-06_Scotts_Valley_Chase_07.jpg"),
  ],
  Política: [
    WM("c/c4/Portuguese_Parliament_building_front_fachade.jpg"),
    WM("1/18/Estonian_parliament_building.jpg"),
    WM("1/1c/Malta%E2%80%99s_Parliament_building_in_Valletta_%28cropped%29.jpg"),
    WM("e/e2/Old_Parliament_Building%2C_Colombo.JPG"),
  ],
  Economia: [
    WM("8/86/10_euro_banknotes_and_10_euro_cent_coins_20180207.jpg"),
    WM("5/55/Twenty_euro_banknote_and_coins.jpg"),
  ],
  Desporto: [
    WM("0/05/Petrovskiy_football_stadium_in_SPB.jpg"),
    WM("5/54/Laugardalsv%C3%B6llur%2C_Iceland%27s_national_football_stadium.jpg"),
    WM("f/f4/Football_stadium_in_Tren%C4%8D%C3%ADn%2C_Slovakia.jpg"),
    WM("4/4c/FC_Prishtina%2C_football_stadium.jpg"),
  ],
  Mundo: [
    WM("3/3e/1_singapore_city_skyline_dusk_panorama_2011.jpg"),
    WM("9/95/Ho_Chi_Minh_City_Skyline.jpg"),
    WM("f/f6/Ho_Chi_Minh_City_Skyline_%28night%29.jpg"),
    WM("d/df/Sharjah_city_skyline_in_2015.jpg"),
  ],
  Cultura: [
    WM("b/bb/Concert_crowd_%28Unsplash%29.jpg"),
    WM("2/2f/Bocelli-concert-crowd-in-abu-dhabi-du-arena-du-live.jpg"),
    WM("c/c5/Home_Free_concert_crowd_%2843188702631%29.jpg"),
    WM("d/de/Go_Between_Bridge_Concert_Crowd_%285160324936%29.jpg"),
  ],
  Tech: [
    WM("f/f3/Digital_nomad_telecommuting_work_on_laptop_computer.jpg"),
    WM("b/b8/X7200_laptop_computer.JPG"),
    WM("d/d0/Young_people_texting_on_smartphones_using_thumbs.JPG"),
    WM("9/96/Samsung_Galaxy_Android_Smartphone.jpg"),
  ],
};
const ALL_REAL = Object.values(REAL_POOL).flat();
const CRIME_RE = /\b(gnr|psp|pol[ií]cia|detid|crime|assalt|tiroteio|homic|preso|roubo)/i;
const hashId = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
};
type ImgItem = { id?: string; image?: string; category?: string; title?: string };
// Candidatas por ordem: foto da notícia → fotos reais do tema → resto do banco.
const candidatesFor = (n: ImgItem) => {
  const key = CRIME_RE.test(n.title ?? "") ? "Crime" : (n.category ?? "Mundo");
  const themed = REAL_POOL[key] ?? REAL_POOL["Mundo"] ?? [];
  const h = hashId(n.id ?? "");
  const rot = (arr: string[]) => arr.map((_, i) => arr[(h + i) % arr.length] as string);
  // Desporto nunca recorre a outros temas (sem mapas/cidades)
  const rest = key === "Desporto" ? [] : ALL_REAL.filter((u) => !themed.includes(u));
  // Último recurso: imagem garantida (Picsum seedado por ID) — sempre carrega.
  const guaranteed = `https://picsum.photos/seed/${(n.id || "news").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "flash"}/1200/800`;
  return [...(n.image ? [n.image] : []), ...rot(themed), ...rot(rest), categoryImage(n.category, n.title), guaranteed];
};
// Tamanho otimizado para telemóvel (~800-960px, comprimido).
const optimizeImage = (url: string) => {
  try {
    const u = new URL(url);
    if (u.hostname === "upload.wikimedia.org" && !u.pathname.includes("/thumb/")) {
      const m = u.pathname.match(/^\/wikipedia\/commons\/(\w\/\w\w)\/([^/]+)$/);
      if (m && m[1] && m[2] && !/\.(svg|tiff?)$/i.test(m[2]))
        return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/1200px-${m[2]}`;
      return url;
    }
    if (
      u.hostname.includes("unsplash.com") ||
      u.hostname.includes("pexels.com") ||
      u.hostname.includes("imgix.net")
    ) {
      u.searchParams.set("w", "1200");
      u.searchParams.set("q", "80");
      u.searchParams.set("auto", "format");
      u.searchParams.set("fit", "crop");
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
};
// Imagem oculta até descarregar por completo; se falhar passa à candidata seguinte.
function FadeImg({
  item,
  className,
  alt = "",
  eager = false,
}: {
  item: ImgItem;
  className: string;
  alt?: string;
  eager?: boolean;
}) {
  const list = useMemo(
    () => candidatesFor(item),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id, item.image, item.category, item.title],
  );
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = list[Math.min(idx, list.length - 1)] ?? `https://picsum.photos/seed/flash${idx}/1200/800`;
  return (
    <img
      key={src}
      src={src === item.image ? src : optimizeImage(src)}
      alt={alt}
      referrerPolicy="no-referrer"
      loading={eager ? "eager" : "lazy"}
      onLoad={(event) => {
        const image = event.currentTarget;
        if (src === item.image && excessiveEnlargement({ width: image.naturalWidth, height: image.naturalHeight }, image.clientWidth, image.clientHeight)) {
          setLoaded(false);
          setIdx((current) => Math.min(current + 1, list.length - 1));
          return;
        }
        setLoaded(true);
      }}
      onError={() => {
        if (idx < list.length - 1) {
          setLoaded(false);
          setIdx(idx + 1);
        }
      }}
      className={`${className} transition-opacity duration-300 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  Cpu,
  Globe,
  Landmark,
  Loader2,
  Newspaper,
  Palette,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { getNews, type GetNewsResult } from "@/lib/news.functions";
import type { NewsItem } from "@/lib/news.types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flash Notícias — Notícias de Portugal em direto" },
      {
        name: "description",
        content:
          "Feed infinito com as últimas notícias de Portugal e do mundo, atualizadas ao minuto: política, economia, desporto, cultura e muito mais.",
      },
      { property: "og:title", content: "Flash Notícias — Notícias de Portugal em direto" },
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

const SAVED_KEY = "aominuto:saved";
const INTERESTS_KEY = "aominuto:interests";

const PAGE_SIZE = 10;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 20) return "Boa tarde";
  return "Boa noite";
}

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
  const mins = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000),
  );
  if (mins < 1) return "Agora mesmo";
  if (mins < 60) return `Há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Há ${hours} h`;
  const days = Math.round(hours / 24);
  return `Há ${days} dia${days > 1 ? "s" : ""}`;
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* ---------- Onboarding ---------- */

const INTEREST_OPTIONS: {
  category: Category;
  label: string;
  icon: React.ReactNode;
}[] = [
  { category: "Política", label: "Política", icon: <Landmark className="size-7" /> },
  { category: "Economia", label: "Economia", icon: <TrendingUp className="size-7" /> },
  { category: "Desporto", label: "Desporto", icon: <Trophy className="size-7" /> },
  { category: "Mundo", label: "Mundo", icon: <Globe className="size-7" /> },
  { category: "Cultura", label: "Cultura", icon: <Palette className="size-7" /> },
  { category: "Tech", label: "Tech", icon: <Cpu className="size-7" /> },
];

function Intro({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const video = ref.current;
    const timer = setTimeout(finish, 4500);
    if (video) {
      video.play().catch(() => {
        video.muted = true;
        void video.play().catch(finish);
      });
    }
    return () => clearTimeout(timer);
  }, [finish]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black">
      <video
        ref={ref}
        src={introUrl}
        playsInline
        autoPlay
        preload="auto"
        className="h-full w-full bg-black object-contain"
        onEnded={finish}
        onError={finish}
      />
    </div>
  );
}

function Onboarding({
  onDone,
  onLater,
}: {
  onDone: (interests: string[]) => void;
  onLater: () => void;
}) {
  const [step, setStep] = useState<"welcome" | "choose">("welcome");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = setTimeout(() => setStep("choose"), 3000);
    return () => clearTimeout(id);
  }, []);

  const toggle = (c: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-feed-bg text-feed-fg">
      {step === "welcome" ? (
        <div className="flex flex-1 animate-rise flex-col items-center justify-center px-8 text-center">
          <span className="text-xs font-bold uppercase tracking-[0.3em] text-live">
            FlashNotícias
          </span>
          <h1 className="mt-4 font-display text-4xl font-black leading-tight text-balance">
            {greeting()}, vamos personalizar a sua experiência
          </h1>
          <p className="mt-4 text-sm text-feed-fg/60">
            As notícias de Portugal e do mundo, ao minuto
          </p>
        </div>
      ) : (
        <div className="flex flex-1 animate-rise flex-col px-6 pb-6 pt-10">
          <h1 className="font-display text-3xl font-black leading-tight text-balance">
            Que tipo de notícias gostas de ver?
          </h1>
          <p className="mt-2 text-sm text-feed-fg/60">
            Escolhe os teus gostos — podes sempre mudar mais tarde.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-x-3 gap-y-6">
            {INTEREST_OPTIONS.map((opt) => {
              const active = picked.has(opt.category);
              return (
                <button
                  key={opt.category}
                  onClick={() => toggle(opt.category)}
                  className="group flex flex-col items-center gap-2"
                  aria-pressed={active}
                >
                  <span
                    className={`flex size-20 items-center justify-center rounded-full transition-all duration-200 active:scale-90 ${
                      active
                        ? "bg-live text-live-foreground shadow-lg shadow-live/30 ring-2 ring-live ring-offset-2 ring-offset-feed-bg"
                        : "bg-feed-fg/10 text-feed-fg/80 group-hover:bg-feed-fg/20"
                    }`}
                  >
                    {opt.icon}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      active ? "text-feed-fg" : "text-feed-fg/60"
                    }`}
                  >
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-auto flex items-center justify-between pt-8">
            <button
              onClick={onLater}
              className="rounded-full px-4 py-2 text-sm font-semibold text-feed-fg/60 underline-offset-4 hover:underline"
            >
              Configurar mais tarde
            </button>
            <button
              onClick={() => onDone([...picked])}
              disabled={picked.size === 0}
              className={`rounded-full px-6 py-2.5 text-sm font-bold transition-colors ${
                picked.size
                  ? "bg-live text-live-foreground hover:bg-live/90"
                  : "cursor-not-allowed bg-feed-fg/10 text-feed-fg/40"
              }`}
            >
              Ver notícias
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Abertura de artigos ---------- */

/**
 * Abre o artigo no site de origem.
 * - Web: novo separador (evita bloqueios X-Frame-Options de iframes).
 * - Nativo (Capacitor): Chrome Custom Tabs / Safari View Controller,
 *   que já incluem a barra nativa com o botão "X" para voltar à app.
 */
// Limpa e valida o URL vindo do feed RSS: remove espaços e carateres
// inválidos no fim e garante que começa sempre por https://.
function cleanUrl(raw: string): string {
  let u = raw.trim().replace(/[\s"'<>]+$/g, "");
  if (u.startsWith("http://")) u = "https://" + u.slice(7);
  if (!u.startsWith("https://")) u = "https://" + u.replace(/^\/+/, "");
  return u;
}

async function openArticle(rawUrl: string): Promise<void> {
  const url = cleanUrl(rawUrl);
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  if (cap?.isNativePlatform?.()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch {
      /* continua para a web */
    }
  }
  // Web: abre SEMPRE num separador novo, nunca dentro da app/iframe
  // (os jornais bloqueiam ser carregados dentro de outra página).
  // Um único link nativo com rel="noopener noreferrer" evita separadores
  // duplicados (window.open com noopener devolve sempre null).
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------- Saved list ---------- */

function SavedList({
  items,
  onOpen,
  onRemove,
  onBack,
}: {
  items: NewsItem[];
  onOpen: (item: NewsItem) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-feed-bg">
      <div className="flex items-center gap-2 px-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-feed-fg"
        >
          <ArrowLeft className="size-5" />
          Voltar
        </button>
      </div>
      {!items.length ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <Bookmark className="size-10 text-muted-foreground/40" />
        <p className="font-display text-xl font-bold">Ainda sem guardadas</p>
        <p className="text-sm text-muted-foreground">
          Toca em "Guardar" numa notícia para a encontrares aqui.
        </p>
      </div>
      ) : (
    <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => (
        <div
          key={item.id}
          className="mb-4 cursor-pointer rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md"
          onClick={() => onOpen(item)}
        >
          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-live">
                {item.source} · {item.category}
              </div>
              <h3 className="mt-1.5 font-display text-xl font-bold leading-snug text-balance">
                {item.title}
              </h3>
              <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                {timeAgo(item.publishedAt)} ·{" "}
                {formatClock(new Date(item.publishedAt))}
              </p>
            </div>
            {(
              <FadeImg
                item={item}
                className="size-20 shrink-0 rounded-lg object-cover"
              />
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.id);
            }}
            className="mt-2 text-[11px] font-semibold text-muted-foreground hover:text-live"
          >
            Remover
          </button>
        </div>
      ))}
    </div>
      )}
    </div>
  );
}

/* ---------- Main ---------- */

function Index() {
  const now = useClock();
  const [mounted, setMounted] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const closeIntro = useCallback(() => setShowIntro(false), []);
  const [interests, setInterests] = useState<string[]>([]);
  const [category, setCategory] = useState<Category>("Tudo");
  const [tab, setTab] = useState<"feed" | "saved">("feed");
  const [savedMap, setSavedMap] = useState<Record<string, NewsItem>>({});
  const feedRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchNews = useServerFn(getNews);

  // Estado local (preferências e guardados)
  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem(SAVED_KEY);
      if (savedRaw) setSavedMap(JSON.parse(savedRaw) as Record<string, NewsItem>);
      const interestsRaw = localStorage.getItem(INTERESTS_KEY);
      if (interestsRaw) {
        const parsed = JSON.parse(interestsRaw) as string[];
        if (Array.isArray(parsed) && parsed.length) setInterests(parsed);
      } else {
        setShowOnboarding(true);
      }
    } catch {
      setShowOnboarding(true);
    }
    setMounted(true);
  }, []);

  const persistSaved = useCallback(
    (next: Record<string, NewsItem>) => {
      setSavedMap(next);
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      } catch {
        /* storage cheio — ignora */
      }
    },
    [],
  );

  const toggleSave = useCallback(
    (item: NewsItem) => {
      setSavedMap((prev) => {
        const next = { ...prev };
        if (next[item.id]) delete next[item.id];
        else next[item.id] = item;
        try {
          localStorage.setItem(SAVED_KEY, JSON.stringify(next));
        } catch {
          /* ignora */
        }
        return next;
      });
    },
    [],
  );

  const query = useInfiniteQuery({
    queryKey: ["news", category, interests.join(",")],
    enabled: mounted,
    refetchInterval: 60_000,
    queryFn: ({ pageParam }) =>
      fetchNews({ data: { offset: pageParam, limit: PAGE_SIZE, category: category === "Tudo" ? undefined : category, interests } }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      return lastPage.hasMore ? loaded : undefined;
    },
  });

  const articles = useMemo(() => {
    const list: NewsItem[] = [];
    const seen = new Set<string>();
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          list.push(item);
        }
      }
    }
    return list;
  }, [query.data]);

  // Infinite scroll sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { root: feedRef.current, threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const startY = e.touches[0]?.clientY ?? 0;
    const startTime = Date.now();
    const onMove = (ev: TouchEvent) => {
      const dy = (ev.touches[0]?.clientY ?? 0) - startY;
      if (Math.abs(dy) > 30 && Date.now() - startTime < 300) {
        /* swipe */
      }
    };
    const onEnd = () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
    document.addEventListener("touchmove", onMove);
    document.addEventListener("touchend", onEnd);
  }, []);

  const onTouchEnd = useCallback(() => {}, []);

  const tickerItems = useMemo(
    () =>
      articles
        .slice(0, 5)
        .map((a) => `${a.source.toUpperCase()} · ${a.title}`),
    [articles],
  );

  const isError = query.isError;

  if (!mounted) {
    return (
      <>
      <div className="mx-auto flex h-[100dvh] w-full max-w-xl items-center justify-center bg-feed-bg">
        <Loader2 className="size-8 animate-spin text-feed-fg/50" />
      </div>
      {showIntro && <Intro onDone={closeIntro} />}
    </>
    );
  }

  return (
    <div className="relative mx-auto h-[100dvh] w-full max-w-xl overflow-hidden bg-feed-bg">
      {showIntro && <Intro onDone={closeIntro} />}
      {showOnboarding && (
        <Onboarding
          onDone={(picked) => {
            setInterests(picked);
            try {
              localStorage.setItem(INTERESTS_KEY, JSON.stringify(picked));
            } catch {
              /* ignora */
            }
            setShowOnboarding(false);
          }}
          onLater={() => setShowOnboarding(false)}
        />
      )}

      {tab === "feed" ? (
        <>
          {/* Feed */}
          <div
            ref={feedRef}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className="h-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {articles.map((a, i) => {
              const fresh =
                Date.now() - new Date(a.publishedAt).getTime() < 60 * 60_000;
              return (
                <article
                  key={a.id}
                  onClick={() => void openArticle(a.url)}
                  className="relative h-[100dvh] w-full snap-start snap-always cursor-pointer overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950"
                >
                  {true ? (
                    <FadeImg
                      item={a}
                      alt={a.title}
                      eager={i === 0}
                      className="absolute inset-0 w-full h-full object-cover object-top"
                    />
                  ) : (
                    <div
                      className={`absolute inset-0 ${
                        a.id.charCodeAt(1) % 2 === 0
                          ? "feed-grad-a"
                          : "feed-grad-b"
                      }`}
                    />
                  )}
                  <div className="absolute inset-0 feed-scrim" />

                  {fresh && (
                    <span className="absolute left-4 top-[104px] z-10 rounded-md bg-live px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-live-foreground">
                      Novo
                    </span>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSave(a);
                    }}
                    aria-label={savedMap[a.id] ? "Guardado" : "Guardar"}
                    className={`absolute right-4 top-1/2 z-10 flex size-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/50 bg-black/25 text-white backdrop-blur-sm ${
                      savedMap[a.id] ? "border-live bg-live/70 text-live-foreground" : ""
                    }`}
                  >
                    <Bookmark
                      className={`size-6 ${savedMap[a.id] ? "fill-current" : ""}`}
                    />
                  </button>

                  {/* Bottom story */}
                  <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-12">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
                      <span className="text-live">{a.source}</span>
                      <span className="text-feed-fg/60">·</span>
                      <span className="text-feed-fg/80">{a.category}</span>
                    </div>
                    <h2 className="mt-2 w-full text-left font-display text-[clamp(1.55rem,6.4vw,2rem)] font-bold leading-tight text-feed-fg drop-shadow-md">
                      {a.title}
                    </h2>
                    <p className="mt-3 text-xs font-medium text-feed-fg/70">
                      <span className="font-bold text-live">
                        {timeAgo(a.publishedAt)}
                      </span>{" "}
                      · {formatClock(new Date(a.publishedAt))} · Toca para ler
                    </p>
                  </div>

                  {i === 0 && (
                    <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 animate-bounce text-feed-fg/70">
                      <ChevronDown className="size-6" />
                    </div>
                  )}
                </article>
              );
            })}


            {isError && !articles.length && (
              <div className="flex h-[100dvh] w-full snap-start items-center justify-center px-8 text-center">
                <p className="text-sm text-feed-fg/70">
                  Não foi possível carregar as notícias. Tenta novamente dentro
                  de instantes.
                </p>
              </div>
            )}

            {query.isSuccess && !isError && !articles.length && (
              <div className="flex h-[100dvh] w-full snap-start items-center justify-center px-8 text-center">
                <p className="font-display text-lg font-bold text-feed-fg/80">
                  Sem notícias recentes nas últimas 24h
                </p>
              </div>
            )}

            {query.isSuccess && articles.length > 0 && !query.hasNextPage && (
              <div className="flex w-full snap-start items-center justify-center px-8 py-16 text-center">
                <p className="text-sm font-medium text-feed-fg/70">
                  Não há mais notícias recentes por agora. Volta daqui a pouco.
                </p>
              </div>
            )}

            <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
          </div>

          {/* Top overlay: masthead + ticker + categories */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto max-w-xl">
            <div className="pointer-events-auto bg-gradient-to-b from-feed-bg/85 to-transparent px-4 pb-6 pt-4 backdrop-blur-[2px]">
              <div className="flex items-end justify-between">
                <h1 className="font-display text-3xl font-black tracking-tight text-feed-fg">
                  Flash<span className="text-live">Notícias</span>
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

              <nav className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                      category === c
                        ? "bg-live text-live-foreground"
                        : "bg-feed-fg/10 text-feed-fg/80 hover:bg-feed-fg/20"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Bottom tab bar */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 mx-auto max-w-xl">
            <div className="pointer-events-auto flex items-center justify-around bg-feed-bg/95 px-4 pb-2 pt-1.5 backdrop-blur-sm">
              <button
                onClick={() => setTab("feed")}
                className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold leading-none ${
                  tab === "feed" ? "text-live" : "text-feed-fg/60"
                }`}
              >
                <Newspaper className="size-4" />
                Feed
              </button>
              <button
                onClick={() => setTab("saved")}
                className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold leading-none ${
                  tab === "saved" ? "text-live" : "text-feed-fg/60"
                }`}
              >
                <Bookmark className="size-4" />
                Guardadas
              </button>
            </div>
          </div>
        </>
      ) : (
        <SavedList
          items={[...Object.values(savedMap)].reverse()}
          onBack={() => setTab("feed")}
          onOpen={(item) => void openArticle(item.url)}
          onRemove={(id) => {
            setSavedMap((prev) => {
              const next = { ...prev };
              delete next[id];
              try {
                localStorage.setItem(SAVED_KEY, JSON.stringify(next));
              } catch {
                /* ignora */
              }
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
