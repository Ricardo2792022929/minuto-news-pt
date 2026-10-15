import { createFileRoute } from "@tanstack/react-router";
import introUrl from "@/assets/intro.mp4";
import { LIGA_CLUBS } from "@/lib/clubs";
import { imageKitUrl } from "@/lib/imagekit";
import { FeedImage } from "@/components/feed-image";

function StoryTitle({
  title,
  open,
  onToggle,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [overflows, setOverflows] = useState(false);
  const words = title.trim().split(/\s+/).filter(Boolean).length;
  const size =
    words > 10 || title.length > 78
      ? "text-[clamp(1.12rem,4.6vw,1.45rem)]"
      : words > 7
        ? "text-[clamp(1.28rem,5.2vw,1.7rem)]"
        : "text-[clamp(1.45rem,6vw,1.95rem)]";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      setOverflows(true);
      return;
    }
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [title, open, size]);

  return (
    <>
      <h2
        ref={ref}
        className={`mt-1.5 w-full text-left font-display font-bold leading-[1.2] tracking-tight text-pretty break-words text-feed-fg drop-shadow-md ${size} ${
          open ? "max-h-[40vh] overflow-y-auto" : "line-clamp-3"
        }`}
      >
        {title}
      </h2>
      {overflows && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
          }}
          className="mt-1 text-left text-[13px] font-semibold text-white/85"
        >
          {open ? "Ver menos" : "Ver mais"}
        </button>
      )}
    </>
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
  EllipsisVertical,
  Globe,
  Landmark,
  Loader2,
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
const CLUB_KEY = "aominuto:club";
const CLUB_ASKED_KEY = "aominuto:club-asked";

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
  const [visible, setVisible] = useState(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // Fecha sempre, mesmo que o vídeo pare ou o browser não dispare "ended".
    const hard = window.setTimeout(finish, 5000);
    const close = () => finish();
    const onTime = () => {
      if (video.currentTime > 0.08) setVisible(true);
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0 && video.currentTime >= duration - 0.08) close();
    };
    const kick = () => {
      video.muted = true;
      const attempt = video.play();
      if (!attempt) return;
      attempt.catch(() => {
        video.play().catch(close);
      });
    };
    video.addEventListener("ended", close);
    video.addEventListener("error", close);
    video.addEventListener("timeupdate", onTime);
    if (video.readyState >= 2) kick();
    else video.addEventListener("canplay", kick, { once: true });
    return () => {
      window.clearTimeout(hard);
      video.removeEventListener("ended", close);
      video.removeEventListener("error", close);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("canplay", kick);
    };
  }, [finish]);

  return (
    <div className="fixed inset-0 z-[80] bg-black">
      <style>{`
        video.flash-intro::-webkit-media-controls,
        video.flash-intro::-webkit-media-controls-enclosure,
        video.flash-intro::-webkit-media-controls-start-playback-button {
          display: none !important;
          -webkit-appearance: none;
          opacity: 0;
        }
      `}</style>
      <video
        ref={ref}
        src={introUrl}
        playsInline
        preload="auto"
        muted
        controls={false}
        disablePictureInPicture
        poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
        className="flash-intro pointer-events-none h-full w-full bg-black object-contain"
        style={{ opacity: visible ? 1 : 0 }}
        onPlaying={() => setVisible(true)}
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
  onDone: (interests: string[], club: string | null) => void;
  onLater: () => void;
}) {
  const hello = `${greeting()}, bem-vindo à Flash Notícias Portugal.`;
  const setupLine = "Vamos personalizar a sua experiência";
  const askLine = "Que tipo de notícias gostas de ver?";
  const clubLine = "Selecione o seu clube favorito";
  const [phase, setPhase] = useState<"greet" | "erase" | "ask" | "club">("greet");
  const [helloCount, setHelloCount] = useState(0);
  const [setupCount, setSetupCount] = useState(0);
  const [askCount, setAskCount] = useState(0);
  const [shownIcons, setShownIcons] = useState(0);
  const [clubCount, setClubCount] = useState(0);
  const [shownClubs, setShownClubs] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pendingClub, setPendingClub] = useState<string | null>(null);
  const clubTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (clubTimer.current) window.clearTimeout(clubTimer.current);
  }, []);

  useEffect(() => {
    if (phase !== "greet") return;
    if (helloCount >= hello.length) {
      const id = window.setTimeout(() => setPhase("erase"), 900);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setHelloCount((n) => n + 1), 42);
    return () => window.clearTimeout(id);
  }, [phase, helloCount, hello]);

  useEffect(() => {
    if (phase !== "erase") return;
    const id = window.setTimeout(() => setPhase("ask"), 680);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "ask") return;
    if (setupCount < setupLine.length) {
      const id = window.setTimeout(() => setSetupCount((n) => n + 1), 36);
      return () => window.clearTimeout(id);
    }
    if (askCount < askLine.length) {
      const id = window.setTimeout(() => setAskCount((n) => n + 1), 34);
      return () => window.clearTimeout(id);
    }
    if (shownIcons < INTEREST_OPTIONS.length) {
      const id = window.setTimeout(() => setShownIcons((n) => n + 1), 190);
      return () => window.clearTimeout(id);
    }
  }, [phase, setupCount, askCount, shownIcons, setupLine.length, askLine.length]);

  useEffect(() => {
    if (phase !== "club") return;
    try {
      localStorage.setItem(CLUB_ASKED_KEY, "1");
    } catch {
      /* ignora */
    }
    if (clubCount < clubLine.length) {
      const id = window.setTimeout(() => setClubCount((n) => n + 1), 36);
      return () => window.clearTimeout(id);
    }
    if (shownClubs < LIGA_CLUBS.length) {
      const id = window.setTimeout(() => setShownClubs((n) => n + 1), 90);
      return () => window.clearTimeout(id);
    }
  }, [phase, clubCount, shownClubs, clubLine.length]);

  const toggle = (c: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const chooseClub = (id: string) => {
    if (pendingClub) return;
    setPendingClub(id);
    clubTimer.current = window.setTimeout(() => onDone([...picked], id), 1000);
  };

  const caret = <span className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[2px] animate-pulse bg-live align-middle" />;

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden bg-feed-bg text-feed-fg">
      {phase === "greet" || phase === "erase" ? (
        <div
          className={`flex flex-1 items-center justify-center px-8 text-center transition-all duration-700 ease-out ${
            phase === "erase" ? "translate-y-2 opacity-0" : "opacity-100"
          }`}
        >
          <h1 className="max-w-sm font-display text-4xl font-black leading-tight text-balance">
            {hello.slice(0, helloCount)}
            {phase === "greet" && helloCount < hello.length ? caret : null}
          </h1>
        </div>
      ) : phase === "ask" ? (
        <div className="flex flex-1 flex-col px-6 pb-6 pt-10">
          <p className="text-sm font-semibold text-live">
            {setupLine.slice(0, setupCount)}
            {setupCount < setupLine.length ? caret : null}
          </p>
          <h1 className="mt-3 min-h-[4.5rem] font-display text-3xl font-black leading-tight text-balance">
            {askLine.slice(0, askCount)}
            {setupCount >= setupLine.length && askCount < askLine.length ? caret : null}
          </h1>
          <p
            className={`mt-2 text-sm text-feed-fg/60 transition-opacity duration-500 ${
              shownIcons >= INTEREST_OPTIONS.length ? "opacity-100" : "opacity-0"
            }`}
          >
            Escolhe os teus gostos — podes sempre mudar mais tarde.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-x-3 gap-y-6">
            {INTEREST_OPTIONS.map((opt, index) => {
              const active = picked.has(opt.category);
              const visible = index < shownIcons;
              return (
                <button
                  key={opt.category}
                  onClick={() => visible && toggle(opt.category)}
                  className="group flex flex-col items-center gap-2"
                  aria-pressed={active}
                  aria-hidden={!visible}
                  tabIndex={visible ? 0 : -1}
                  style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "scale(1)" : "scale(0.7)",
                    transition: "opacity 460ms ease, transform 460ms cubic-bezier(.2,1.25,.32,1)",
                  }}
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
                  <span className={`text-xs font-semibold ${active ? "text-feed-fg" : "text-feed-fg/60"}`}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            className={`mt-auto flex items-center justify-between pt-8 transition-opacity duration-500 ${
              shownIcons >= INTEREST_OPTIONS.length ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <button
              onClick={onLater}
              className="rounded-full px-4 py-2 text-sm font-semibold text-feed-fg/60 underline-offset-4 hover:underline"
            >
              Configurar mais tarde
            </button>
            <button
              onClick={() => setPhase("club")}
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
      ) : (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6 pt-10">
          <div className="flex shrink-0 items-start justify-between gap-3">
            <h1 className="min-h-[4.5rem] flex-1 font-display text-3xl font-black leading-tight text-balance">
              {clubLine.slice(0, clubCount)}
              {clubCount < clubLine.length ? caret : null}
            </h1>
            <button
              onClick={() => onDone([...picked], null)}
              className="mt-1 max-w-[8.5rem] shrink-0 rounded-2xl bg-feed-fg px-3 py-3 text-xs font-bold text-feed-bg shadow-xl"
              style={{
                opacity: clubCount >= clubLine.length ? 1 : 0,
                transform: clubCount >= clubLine.length ? "scale(1)" : "scale(0.7)",
                transition: "opacity 400ms ease, transform 400ms cubic-bezier(.2,1.3,.32,1)",
                pointerEvents: clubCount >= clubLine.length ? "auto" : "none",
              }}
            >
              Configurar mais tarde
            </button>
          </div>
          <div
            className="mt-6 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain pb-8 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="flex flex-col gap-2">
              {LIGA_CLUBS.map((club, index) => {
                const visible = index < shownClubs;
                const selected = pendingClub === club.id;
                return (
                  <button
                    key={club.id}
                    onClick={() => visible && chooseClub(club.id)}
                    disabled={pendingClub !== null}
                    className={`flex items-center justify-between rounded-full px-4 py-3 text-left text-sm font-semibold active:scale-[0.98] ${
                      selected ? "bg-red-600 text-white" : "bg-feed-fg/10 text-feed-fg"
                    }`}
                    style={{
                      opacity: visible ? 1 : 0,
                      transform: visible ? "scale(1)" : "scale(0.86)",
                      transition: "opacity 420ms ease, transform 420ms cubic-bezier(.2,1.25,.32,1), background-color 180ms ease",
                    }}
                  >
                    <span>{club.name}</span>
                    {selected ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
                  </button>
                );
              })}
            </div>
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

const warmedOrigins = new Set<string>();

function warmOrigin(rawUrl: string) {
  let origin = "";
  try {
    origin = new URL(cleanUrl(rawUrl)).origin;
  } catch {
    return;
  }
  if (warmedOrigins.has(origin)) return;
  warmedOrigins.add(origin);
  const pre = document.createElement("link");
  pre.rel = "preconnect";
  pre.href = origin;
  pre.crossOrigin = "anonymous";
  document.head.appendChild(pre);
  const dns = document.createElement("link");
  dns.rel = "dns-prefetch";
  dns.href = origin;
  document.head.appendChild(dns);
}

if (typeof window !== "undefined") {
  const early = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (early?.isNativePlatform?.()) void import("@capacitor/browser");
}

async function openArticle(rawUrl: string): Promise<void> {
  const url = cleanUrl(rawUrl);
  warmOrigin(url);
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
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
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
              <FeedImage
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

function LiveWhen() {
  const now = useClock();
  return (
    <span className="text-xs font-semibold uppercase tracking-widest text-feed-fg/80">
      Em direto · {formatClock(now)}
    </span>
  );
}

function LiveDateLine() {
  const now = useClock();
  return (
    <p className="mt-0.5 text-[11px] capitalize text-feed-fg/60">
      {formatDate(now)} · Lisboa
    </p>
  );
}

function useLockedFeedHeight() {
  useEffect(() => {
    const root = document.documentElement;
    let last = window.innerHeight;
    const apply = (height: number) => {
      last = height;
      root.style.setProperty("--feed-h", `${height}px`);
    };
    apply(window.innerHeight);
    const onOrient = () => apply(window.innerHeight);
    const onResize = () => {
      const height = window.innerHeight;
      if (Math.abs(height - last) > 140) apply(height);
    };
    window.addEventListener("orientationchange", onOrient);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("orientationchange", onOrient);
      window.removeEventListener("resize", onResize);
    };
  }, []);
}
function Index() {
  useLockedFeedHeight();
  const [mounted, setMounted] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [club, setClub] = useState("");
  const closeIntro = useCallback(() => {
    try {
      sessionStorage.setItem("flash:intro-seen", "1");
    } catch {
      /* ignora */
    }
    setShowIntro(false);
  }, []);
  const [interests, setInterests] = useState<string[]>([]);
  const [category, setCategory] = useState<Category>("Tudo");
  const [tab, setTab] = useState<"feed" | "saved">("feed");
  const [openTitle, setOpenTitle] = useState<string | null>(null);
  const [savedMap, setSavedMap] = useState<Record<string, NewsItem>>({});
  const feedRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(0);
  const [page, setPage] = useState(0);
  const countRef = useRef(0);
  const articlesRef = useRef<NewsItem[]>([]);
  const fetchMoreRef = useRef<() => void>(() => {});
  const hasMoreRef = useRef(false);

  const fetchNews = useServerFn(getNews);

  // Estado local (preferências e guardados)
  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem(SAVED_KEY);
      if (savedRaw) setSavedMap(JSON.parse(savedRaw) as Record<string, NewsItem>);
      const interestsRaw = localStorage.getItem(INTERESTS_KEY);
      const clubRaw = localStorage.getItem(CLUB_KEY);
      if (clubRaw) setClub(clubRaw);
      if (interestsRaw) {
        const parsed = JSON.parse(interestsRaw) as string[];
        if (Array.isArray(parsed) && parsed.length) {
          setInterests(parsed);
        } else setShowOnboarding(true);
      } else {
        setShowOnboarding(true);
      }
    } catch {
      setShowOnboarding(true);
    }
    try {
      setShowIntro(sessionStorage.getItem("flash:intro-seen") !== "1");
    } catch {
      setShowIntro(true);
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
    queryKey: ["news", category, interests.join(","), club],
    enabled: mounted,
    refetchInterval: 60_000,
    queryFn: ({ pageParam }) =>
      fetchNews({ data: { offset: pageParam, limit: PAGE_SIZE, category: category === "Tudo" ? undefined : category, interests, club: club || undefined } }),
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
  countRef.current = articles.length;
  articlesRef.current = articles;
  fetchMoreRef.current = () => {
    if (hasMoreRef.current) void query.fetchNextPage();
  };
  hasMoreRef.current = Boolean(query.hasNextPage);

  useEffect(() => {
    for (const item of articles.slice(0, 4)) warmOrigin(item.url);
    for (const item of articles.slice(0, 6)) {
      const src = item.image ? imageKitUrl(item.image) ?? item.image : null;
      if (!src) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = src;
    }
  }, [articles]);

  useEffect(() => {
    document.querySelector(`[data-cat="${category}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [category]);
  const swiped = useRef(false);

  useEffect(() => {
    pageRef.current = 0;
    setPage(0);
    const track = trackRef.current;
    const view = feedRef.current;
    if (!track || !view) return;
    track.style.transition = "none";
    track.style.transform = "translate3d(0, 0, 0)";
  }, [category, club, interests]);

  useEffect(() => {
    if (tab !== "feed") return;
    const view = feedRef.current;
    const track = trackRef.current;
    if (!view || !track) return;

    const height = () => {
      const px = view.clientHeight || window.innerHeight;
      view.style.setProperty("--slide-h", `${px}px`);
      return px;
    };
    const place = (pageIndex: number, drag: number, animate: boolean) => {
      const max = Math.max(countRef.current - 1, 0);
      const clamped = Math.max(0, Math.min(max, pageIndex));
      track.style.transition = animate ? "transform 240ms cubic-bezier(.22,1,.36,1)" : "none";
      track.style.transform = `translate3d(0, ${-clamped * height() + drag}px, 0)`;
    };
    place(pageRef.current, 0, false);

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let tracking = false;

    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      tracking = true;
      startX = event.clientX;
      startY = lastY = event.clientY;
      lastT = performance.now();
      velocity = 0;
      view.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!tracking) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 16) return;
      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) velocity = (event.clientY - lastY) / dt;
      lastY = event.clientY;
      lastT = now;
      const atStart = pageRef.current <= 0 && dy > 0;
      const atEnd = pageRef.current >= countRef.current - 1 && dy < 0;
      place(pageRef.current, atStart || atEnd ? dy * 0.28 : dy, false);
    };
    const up = (event: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) {
        swiped.current = true;
        window.setTimeout(() => { swiped.current = false; }, 450);
        setCategory((current) => {
          const index = CATEGORIES.indexOf(current);
          const next = dx < 0 ? Math.min(index + 1, CATEGORIES.length - 1) : Math.max(index - 1, 0);
          return CATEGORIES[next];
        });
        place(pageRef.current, 0, true);
        return;
      }
      const h = height();
      let next = pageRef.current;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
        const item = articlesRef.current[pageRef.current];
        if (item) {
          const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
          if (cap?.isNativePlatform?.()) void openArticle(item.url);
          else window.open(cleanUrl(item.url), "_blank", "noopener");
        }
        place(next, 0, false);
        return;
      }
      if (dy < -h * 0.16 || velocity < -0.45) next += 1;
      else if (dy > h * 0.16 || velocity > 0.45) next -= 1;
      next = Math.max(0, Math.min(Math.max(countRef.current - 1, 0), next));
      if (next !== pageRef.current) {
        swiped.current = true;
        window.setTimeout(() => { swiped.current = false; }, 450);
      }
      pageRef.current = next;
      setPage(next);
      place(next, 0, true);
      if (next >= countRef.current - 3) fetchMoreRef.current();
    };
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 12) return;
      event.preventDefault();
      if (track.dataset.lock === "1") return;
      track.dataset.lock = "1";
      const dir = event.deltaY > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(Math.max(countRef.current - 1, 0), pageRef.current + dir));
      pageRef.current = next;
      setPage(next);
      place(next, 0, true);
      if (next >= countRef.current - 3) fetchMoreRef.current();
      window.setTimeout(() => { delete track.dataset.lock; }, 380);
    };

    view.addEventListener("pointerdown", down);
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", up);
    view.addEventListener("pointercancel", up);
    view.addEventListener("wheel", wheel, { passive: false });
    return () => {
      view.removeEventListener("pointerdown", down);
      view.removeEventListener("pointermove", move);
      view.removeEventListener("pointerup", up);
      view.removeEventListener("pointercancel", up);
      view.removeEventListener("wheel", wheel);
    };
  }, [tab, mounted]);

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
      <div className="mx-auto h-[var(--feed-h,100svh)] w-full max-w-xl bg-black" />
    );
  }

  return (
    <div className="relative mx-auto h-[var(--feed-h,100svh)] w-full max-w-xl overflow-hidden bg-feed-bg">
      {showIntro && <Intro onDone={closeIntro} />}
      {showOnboarding && !showIntro && (
        <Onboarding
          onDone={(picked, chosen) => {
            if (picked.length) {
              setInterests(picked);
              try {
                localStorage.setItem(INTERESTS_KEY, JSON.stringify(picked));
              } catch {
                /* ignora */
              }
            }
            try {
              localStorage.setItem(CLUB_ASKED_KEY, "1");
              if (chosen) {
                setClub(chosen);
                localStorage.setItem(CLUB_KEY, chosen);
              }
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
          <div ref={feedRef} className="absolute inset-0 overflow-hidden" style={{ touchAction: "none" }}>
            <div ref={trackRef} className="will-change-transform">
            {articles.map((a, i) => {
              const fresh =
                Date.now() - new Date(a.publishedAt).getTime() < 60 * 60_000;
              return (
                <a
                  key={a.id}
                  href={cleanUrl(a.url)}
                  target="_blank"
                  onPointerDown={() => warmOrigin(a.url)}
                  onClick={(e) => {
                    e.preventDefault();
                    if (swiped.current) return;
                  }}
                  className="relative block w-full overflow-hidden bg-black"
                  style={{ height: "var(--slide-h, var(--feed-h, 100svh))" }}
                >
                  {true ? (
                    <FeedImage
                      item={a}
                      alt={a.title}
                      eager={i < 2}
                      className="absolute inset-0 w-full h-full object-cover object-center"
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

                  {/* Bottom story */}
                  <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-5 pb-[max(1.35rem,calc(env(safe-area-inset-bottom)+0.85rem))] pr-20 pt-20">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
                      <span className="text-live">{a.source}</span>
                      <span className="text-feed-fg/60">·</span>
                      <span className="text-feed-fg/80">{a.category}</span>
                    </div>
                    <StoryTitle
                      title={a.title}
                      open={openTitle === a.id}
                      onToggle={() => setOpenTitle((current) => (current === a.id ? null : a.id))}
                    />
                    <p className="mt-2.5 text-xs font-medium text-feed-fg/75">
                      <span className="font-bold text-live">
                        {timeAgo(a.publishedAt)}
                      </span>{" "}
                      · {formatClock(new Date(a.publishedAt))} · Toca para ler
                    </p>
                  </div>

                  {i === 0 && (
                    <div className="pointer-events-none absolute left-1/2 top-[42%] z-10 -translate-x-1/2 animate-bounce text-feed-fg/70">
                      <ChevronDown className="size-6" />
                    </div>
                  )}
                </a>
              );
            })}


            {isError && !articles.length && (
              <div className="flex w-full items-center justify-center px-8 text-center" style={{ height: "var(--feed-h, 100svh)" }}>
                <p className="text-sm text-feed-fg/70">
                  Não foi possível carregar as notícias. Tenta novamente dentro
                  de instantes.
                </p>
              </div>
            )}

            {query.isSuccess && !isError && !articles.length && (
              <div className="flex w-full items-center justify-center px-8 text-center" style={{ height: "var(--feed-h, 100svh)" }}>
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

            </div>
          </div>

          {articles[page] && (
            <div className="absolute right-4 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => toggleSave(articles[page])}
                aria-label={savedMap[articles[page].id] ? "Guardado" : "Guardar"}
                className={`flex size-12 items-center justify-center rounded-full border border-white/40 bg-black/45 text-white ${
                  savedMap[articles[page].id] ? "border-live bg-live/70 text-live-foreground" : ""
                }`}
              >
                <Bookmark className={`size-6 ${savedMap[articles[page].id] ? "fill-current" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => setTab("saved")}
                aria-label="Guardadas"
                className="flex size-12 items-center justify-center rounded-full border border-white/40 bg-black/45 text-white"
              >
                <EllipsisVertical className="size-6" />
              </button>
            </div>
          )}

          {/* Top overlay: masthead + ticker + categories */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 mx-auto max-w-xl">
            <div className="pointer-events-auto bg-feed-bg px-4 pt-4">
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
                    <LiveWhen />
                  </span>
                </div>
              </div>
              <LiveDateLine />

              {tickerItems.length > 0 && (
                <div className="mt-2 overflow-hidden rounded-full bg-black/35 py-1.5">
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
                    data-cat={c}
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
              <div className="mt-3 h-0.5 w-full bg-live" aria-hidden="true" />
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
