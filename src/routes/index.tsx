import { createFileRoute, Link } from "@tanstack/react-router";
import { preloadIntroVideo } from "@/lib/intro-preload";
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
      ? "text-[clamp(1.25rem,5vw,1.6rem)]"
      : words > 7
        ? "text-[clamp(1.42rem,5.7vw,1.85rem)]"
        : "text-[clamp(1.58rem,6.5vw,2.1rem)]";

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
          open ? "max-h-[40vh] overflow-y-auto" : "line-clamp-4"
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
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Bookmark,
  Cpu,
  EllipsisVertical,
  Globe,
  Landmark,
  Loader2,
  Palette,
  Phone,
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
  { category: "Política", label: "Política", icon: <Landmark className="size-5" /> },
  { category: "Economia", label: "Economia", icon: <TrendingUp className="size-5" /> },
  { category: "Desporto", label: "Desporto", icon: <Trophy className="size-5" /> },
  { category: "Mundo", label: "Mundo", icon: <Globe className="size-5" /> },
  { category: "Cultura", label: "Cultura", icon: <Palette className="size-5" /> },
  { category: "Tech", label: "Tech", icon: <Cpu className="size-5" /> },
];

function Intro({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    let live = true;
    void preloadIntroVideo().then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    const hard = window.setTimeout(finish, 7000);
    const close = () => finish();
    const reveal = () => {
      if (!video.paused && video.currentTime > 0.05) setVisible(true);
    };
    const kick = () => {
      video.muted = true;
      video.defaultMuted = true;
      const attempt = video.play();
      if (!attempt) return;
      attempt.then(reveal).catch(() => {
        video.play().then(reveal).catch(close);
      });
    };
    const onTime = () => {
      reveal();
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0 && video.currentTime >= duration - 0.08) close();
    };
    video.addEventListener("ended", close);
    video.addEventListener("error", close);
    video.addEventListener("playing", reveal);
    video.addEventListener("timeupdate", onTime);
    if (video.readyState >= 3) kick();
    else video.addEventListener("canplay", kick, { once: true });
    return () => {
      window.clearTimeout(hard);
      video.removeEventListener("ended", close);
      video.removeEventListener("error", close);
      video.removeEventListener("playing", reveal);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("canplay", kick);
    };
  }, [finish, src]);

  return (
    <div className="fixed inset-0 z-[80] overflow-hidden bg-black">
      <style>{`
        video.flash-intro::-webkit-media-controls,
        video.flash-intro::-webkit-media-controls-enclosure,
        video.flash-intro::-webkit-media-controls-panel,
        video.flash-intro::-webkit-media-controls-start-playback-button,
        video.flash-intro::-webkit-media-controls-overlay-play-button {
          display: none !important;
          -webkit-appearance: none;
          opacity: 0;
          width: 0;
          height: 0;
        }
      `}</style>
      {src ? (
        <video
          ref={ref}
          src={src}
          playsInline
          preload="auto"
          muted
          autoPlay
          controls={false}
          disablePictureInPicture
          poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
          className="flash-intro pointer-events-none h-full w-full bg-black object-contain"
          style={{
            opacity: visible ? 1 : 0,
            transform: "translateZ(0)",
          }}
          onPlaying={() => setVisible(true)}
          onEnded={finish}
          onError={finish}
        />
      ) : null}
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
  const [shownIcons, setShownIcons] = useState(0);
  const [shownClubs, setShownClubs] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pendingClub, setPendingClub] = useState<string | null>(null);
  const clubTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (clubTimer.current) window.clearTimeout(clubTimer.current);
  }, []);

  useEffect(() => {
    if (phase !== "greet") return;
    const id = window.setTimeout(() => setPhase("erase"), 1100);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "erase") return;
    const id = window.setTimeout(() => setPhase("ask"), 320);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "ask") return;
    let count = 0;
    const id = window.setInterval(() => {
      count += 1;
      setShownIcons(count);
      if (count >= INTEREST_OPTIONS.length) window.clearInterval(id);
    }, 55);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "club") return;
    try {
      localStorage.setItem(CLUB_ASKED_KEY, "1");
    } catch {
      /* ignora */
    }
    let count = 0;
    const id = window.setInterval(() => {
      count += 1;
      setShownClubs(count);
      if (count >= LIGA_CLUBS.length) window.clearInterval(id);
    }, 24);
    return () => window.clearInterval(id);
  }, [phase]);

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

  const step = phase === "club" ? 2 : 1;

  return (
    <div className="fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-feed-bg text-feed-fg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-live/15 blur-3xl" />
      {phase === "greet" || phase === "erase" ? (
        <div
          className={`relative flex flex-1 flex-col items-center justify-center px-8 text-center transition-all duration-300 ease-out ${
            phase === "erase" ? "translate-y-1 opacity-0" : "animate-rise opacity-100"
          }`}
        >
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-feed-fg/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-feed-fg/70">
            <span className="size-1.5 animate-live-pulse rounded-full bg-live" />
            Flash Notícias
          </span>
          <h1 className="max-w-sm font-display text-4xl font-black leading-tight text-balance">
            {hello}
          </h1>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-feed-fg/60">
            Um feed curto, feito para o telemóvel. Escolhe o que queres ver.
          </p>
        </div>
      ) : (
        <>
          <div className="relative flex items-center justify-between px-6 pt-[max(1.25rem,env(safe-area-inset-top))]">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-live">Flash</p>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-feed-fg/50">
              Passo {step} de 2
            </p>
          </div>
          <div className="relative mx-6 mt-3 h-1 overflow-hidden rounded-full bg-feed-fg/10">
            <div
              className="h-full rounded-full bg-live transition-all duration-500"
              style={{ width: step === 1 ? "50%" : "100%" }}
            />
          </div>
          {phase === "ask" ? (
            <div className="relative flex min-h-0 flex-1 flex-col px-6 pb-6 pt-8">
              <p className="text-sm font-semibold text-live">{setupLine}</p>
              <h1 className="mt-3 font-display text-3xl font-black leading-tight text-balance">
                {askLine}
              </h1>
              <p
                className={`mt-2 text-sm text-feed-fg/60 transition-opacity duration-500 ${
                  shownIcons >= INTEREST_OPTIONS.length ? "opacity-100" : "opacity-0"
                }`}
              >
                Toca nos temas. Podes mudar isto mais tarde.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {INTEREST_OPTIONS.map((opt, index) => {
                  const active = picked.has(opt.category);
                  const visible = index < shownIcons;
                  return (
                    <button
                      key={opt.category}
                      onClick={() => visible && toggle(opt.category)}
                      className={`flex min-h-24 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-200 active:scale-[0.98] ${
                        active
                          ? "border-live bg-live text-live-foreground shadow-lg shadow-live/20"
                          : "border-feed-fg/10 bg-feed-fg/5 text-feed-fg"
                      }`}
                      aria-pressed={active}
                      aria-hidden={!visible}
                      tabIndex={visible ? 0 : -1}
                      style={{
                        opacity: visible ? 1 : 0,
                        transform: visible ? "translateY(0)" : "translateY(8px)",
                        transition: "opacity 420ms ease, transform 420ms cubic-bezier(.2,1.2,.32,1), background-color 180ms ease",
                      }}
                    >
                      <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${active ? "bg-live-foreground/15" : "bg-feed-fg/10"}`}>
                        {opt.icon}
                      </span>
                      <span className="text-sm font-semibold">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              <div
                className={`mt-auto flex items-center justify-between gap-3 pt-6 transition-opacity duration-500 ${
                  shownIcons >= INTEREST_OPTIONS.length ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
              >
                <button
                  onClick={onLater}
                  className="rounded-full px-3 py-3 text-sm font-semibold text-feed-fg/60"
                >
                  Agora não
                </button>
                <button
                  onClick={() => setPhase("club")}
                  disabled={picked.size === 0}
                  className={`min-h-11 rounded-full px-6 py-3 text-sm font-bold transition-colors ${
                    picked.size
                      ? "bg-live text-live-foreground"
                      : "cursor-not-allowed bg-feed-fg/10 text-feed-fg/40"
                  }`}
                >
                  Continuar
                </button>
              </div>
            </div>
          ) : (
            <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6 pt-8">
              <div className="flex shrink-0 items-start justify-between gap-3">
                <h1 className="flex-1 font-display text-3xl font-black leading-tight text-balance">
                  {clubLine}
                </h1>
              </div>
              <p className="text-sm text-feed-fg/60">Só para dar prioridade ao desporto. Não é obrigatório.</p>
              <div className="mt-5 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex flex-col gap-2">
                  {LIGA_CLUBS.map((club, index) => {
                    const shown = index < shownClubs;
                    const selected = pendingClub === club.id;
                    const mark = club.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
                    return (
                      <button
                        key={club.id}
                        onClick={() => shown && chooseClub(club.id)}
                        disabled={pendingClub !== null}
                        className={`flex min-h-12 items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold active:scale-[0.99] ${
                          selected ? "bg-live text-live-foreground" : "bg-feed-fg/10 text-feed-fg"
                        }`}
                        style={{
                          opacity: shown ? 1 : 0,
                          transform: shown ? "translateY(0)" : "translateY(6px)",
                          transition: "opacity 360ms ease, transform 360ms cubic-bezier(.2,1.2,.32,1), background-color 180ms ease",
                        }}
                      >
                        <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${selected ? "bg-live-foreground/15" : "bg-feed-fg/10"}`}>
                          {mark}
                        </span>
                        <span className="flex-1">{club.name}</span>
                        {selected ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={() => onDone([...picked], null)}
                className="mt-2 min-h-11 shrink-0 rounded-full py-3 text-sm font-semibold text-feed-fg/70"
              >
                Continuar sem clube
              </button>
            </div>
          )}
        </>
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
        <p className="font-display text-lg font-black">Guardadas</p>
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
    <span className="text-[11px] font-semibold text-feed-fg/75">
      Em direto · {formatClock(now)}
    </span>
  );
}

function LiveDateLine() {
  const now = useClock();
  const [city, setCity] = useState("Lisboa");
  useEffect(() => {
    let active = true;
    const cached = sessionStorage.getItem("flash:city");
    if (cached) { setCity(cached); return; }
    fetch("https://ipwho.is/")
      .then((res) => res.json())
      .then((data: { success?: boolean; city?: string; country_code?: string }) => {
        if (!active || !data.success || !data.city) return;
        const label = data.country_code === "PT" ? data.city : `${data.city}`;
        sessionStorage.setItem("flash:city", label);
        setCity(label);
      })
      .catch(() => { /* fica Lisboa */ });
    return () => { active = false; };
  }, []);
  return (
    <p className="mt-0.5 text-[11px] capitalize text-feed-fg/60">
      {formatDate(now)} · {city}
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
  const navRef = useRef<HTMLElement>(null);
  const [category, setCategory] = useState<Category>("Tudo");
  const [indicator, setIndicator] = useState({ left: 0, width: 72 });
  useEffect(() => {
    if (!mounted) return;
    const measure = () => {
      const nav = navRef.current;
      if (!nav) return;
      const btn = nav.querySelector<HTMLElement>(`[data-cat="${category}"]`);
      if (!btn) return;
      setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    measure();
    const timer = window.setTimeout(measure, 50);
    return () => window.clearTimeout(timer);
  }, [category, mounted]);
  const [slide, setSlide] = useState<"left" | "right" | null>(null);
  const [dragX, setDragX] = useState(0);
  const [settling, setSettling] = useState(false);
  const [prevArticles, setPrevArticles] = useState<NewsItem[]>([]);
  const [sidePreview, setSidePreview] = useState<{ left?: NewsItem; right?: NewsItem }>({});
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"feed" | "saved">("feed");
  const [openTitle, setOpenTitle] = useState<string | null>(null);
  const [savedMap, setSavedMap] = useState<Record<string, NewsItem>>({});
  const feedRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const mastheadRef = useRef<HTMLDivElement>(null);
  const [mastheadH, setMastheadH] = useState(0);
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
    if (!mounted || tab !== "feed") return;
    if (articles.length < 12 && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [mounted, tab, articles.length, query.hasNextPage, query.isFetchingNextPage, query]);

  useEffect(() => {
    for (const item of articles.slice(0, 6)) warmOrigin(item.url);
    for (const item of articles.slice(0, 8)) {
      const src = item.image ? imageKitUrl(item.image) ?? item.image : null;
      if (!src) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = src;
    }
  }, [articles]);

  useEffect(() => {
    const next = articles.slice(page, page + 3);
    for (const item of next) {
      const src = item.image ? imageKitUrl(item.image) ?? item.image : null;
      if (!src) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = src;
    }
  }, [page, articles]);

  useEffect(() => {
    if (!mounted || tab !== "feed") return;
    const bar = mastheadRef.current;
    if (!bar) return;
    const apply = () => setMastheadH(Math.ceil(bar.getBoundingClientRect().height));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [tab, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const index = CATEGORIES.indexOf(category);
    const neighbors = [CATEGORIES[index - 1], CATEGORIES[index + 1]].filter(Boolean);
    for (const neighbor of neighbors) {
      const key = ["news", neighbor, interests.join(","), club];
      queryClient.prefetchInfiniteQuery({
        queryKey: key,
        queryFn: ({ pageParam }) => fetchNews({ data: { offset: pageParam as number, limit: PAGE_SIZE, category: neighbor === "Tudo" ? undefined : neighbor, interests, club: club || undefined } }),
        initialPageParam: 0,
      }).then(() => {
        const data = queryClient.getQueryData<{ pages: { items: NewsItem[] }[] }>(key);
        const first = data?.pages?.[0]?.items?.[0];
        if (!first) return;
        const side = CATEGORIES.indexOf(neighbor) < index ? "left" : "right";
        setSidePreview((prev) => ({ ...prev, [side]: first }));
        if (first.image) {
          const img = new Image();
          img.src = imageKitUrl(first.image) ?? first.image;
        }
      });
    }
  }, [category, mounted, interests, club, queryClient, fetchNews]);
  const swiped = useRef(false);
  const trackLock = useRef(false);

  useEffect(() => {
    if (!mounted) return;
    const btn = navRef.current?.querySelector<HTMLElement>(`[data-cat="${category}"]`);
    btn?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [category, mounted]);

  useEffect(() => {
    pageRef.current = 0;
    setPage(0);
    const view = feedRef.current;
    if (view) view.scrollTo({ top: 0 });
  }, [category, club, interests]);

  useEffect(() => {
    if (tab !== "feed") return;
    const view = feedRef.current;
    if (!view) return;

    const height = () => view.clientHeight || window.innerHeight;
    const indexFromScroll = () => Math.round(view.scrollTop / Math.max(height(), 1));

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let horizontal = false;
    let decided = false;

    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button")) return;
      tracking = true;
      horizontal = false;
      decided = false;
      startX = event.clientX;
      startY = event.clientY;
    };
    const move = (event: PointerEvent) => {
      if (!tracking) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = true;
        horizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (!horizontal) return;
      event.preventDefault();
      const index = CATEGORIES.indexOf(category);
      const atStart = index <= 0 && dx > 0;
      const atEnd = index >= CATEGORIES.length - 1 && dx < 0;
      if (atStart || atEnd) { setDragX(0); return; }
      setDragX(dx);
    };
    const up = (event: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (horizontal && Math.abs(dx) > 50) {
        swiped.current = true;
        window.setTimeout(() => { swiped.current = false; }, 400);
        const dir = dx < 0 ? "left" : "right";
        const width = view.clientWidth || window.innerWidth;
        const target = dir === "left" ? -width : width;
        setSettling(true);
        setDragX(target);
        window.setTimeout(() => {
          setPrevArticles(articlesRef.current);
          setCategory((current) => {
            const index = CATEGORIES.indexOf(current);
            return CATEGORIES[dir === "left" ? Math.min(index + 1, CATEGORIES.length - 1) : Math.max(index - 1, 0)];
          });
          setDragX(0);
          setSettling(false);
        }, 220);
        return;
      }
      setSettling(true);
      setDragX(0);
      window.setTimeout(() => setSettling(false), 180);
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
        const item = articlesRef.current[indexFromScroll()];
        if (item) {
          const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
          if (cap?.isNativePlatform?.()) void openArticle(item.url);
          else window.open(cleanUrl(item.url), "_blank", "noopener");
        }
      }
    };
    const onScroll = () => {
      const next = Math.max(0, Math.min(Math.max(countRef.current - 1, 0), indexFromScroll()));
      if (next !== pageRef.current) {
        pageRef.current = next;
        setPage(next);
        if (next >= countRef.current - 3) fetchMoreRef.current();
      }
    };
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 12 || trackLock.current) return;
      event.preventDefault();
      trackLock.current = true;
      const dir = event.deltaY > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(Math.max(countRef.current - 1, 0), pageRef.current + dir));
      view.scrollTo({ top: next * height(), behavior: "smooth" });
      window.setTimeout(() => { trackLock.current = false; }, 420);
    };

    view.addEventListener("pointerdown", down);
    view.addEventListener("pointermove", move, { passive: false });
    view.addEventListener("pointerup", up);
    view.addEventListener("pointercancel", up);
    view.addEventListener("scroll", onScroll, { passive: true });
    view.addEventListener("wheel", wheel, { passive: false });
    return () => {
      view.removeEventListener("pointerdown", down);
      view.removeEventListener("pointermove", move);
      view.removeEventListener("pointerup", up);
      view.removeEventListener("pointercancel", up);
      view.removeEventListener("scroll", onScroll);
      view.removeEventListener("wheel", wheel);
    };
  }, [tab, mounted, mastheadH, category]);

  const tickerItems = useMemo(
    () =>
      articles
        .slice(0, 5)
        .map((a) => `${a.source} · ${a.title}`),
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
          <div className="absolute inset-x-0 bottom-0 z-0 overflow-hidden" style={{ top: mastheadH }}>
            {dragX !== 0 && (
              <div
                className="absolute inset-0 z-20 overflow-hidden bg-black"
                style={{
                  transform: `translateX(${dragX > 0 ? dragX - (feedRef.current?.clientWidth || window.innerWidth) : dragX + (feedRef.current?.clientWidth || window.innerWidth)}px)`,
                  transition: settling ? "transform 220ms cubic-bezier(.22,1,.36,1)" : "none",
                  willChange: "transform",
                }}
              >
                {(() => {
                  const preview = dragX < 0 ? sidePreview.right : sidePreview.left;
                  return preview ? (
                    <>
                      <FeedImage item={preview} alt="" className="absolute inset-0 h-full w-full" />
                      <div className="absolute inset-0 feed-scrim" />
                      <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-8">
                        <h2 className="font-display text-2xl font-bold text-white">{preview.title}</h2>
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-white/60">
                      <span className="text-sm font-semibold uppercase tracking-widest">
                        {CATEGORIES[CATEGORIES.indexOf(category) + (dragX < 0 ? 1 : -1)] ?? ""}
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}
            {slide && prevArticles.length > 0 && (
              <div className="absolute inset-0 z-10 overflow-hidden" style={{ opacity: 0, pointerEvents: "none" }}>
                <div className="relative h-full w-full overflow-hidden bg-black" />
              </div>
            )}
            <div
              ref={feedRef}
              className={`absolute inset-0 overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
              style={{
                scrollSnapType: "y mandatory",
                WebkitOverflowScrolling: "touch",
                touchAction: "pan-y",
                transform: dragX ? `translateX(${dragX}px)` : undefined,
                transition: settling ? "transform 220ms cubic-bezier(.22,1,.36,1)" : "none",
                willChange: dragX ? "transform" : undefined,
              }}
            >
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
                  className="relative block w-full snap-start snap-always overflow-hidden bg-black"
                  style={{ height: "100%", minHeight: "100%", scrollSnapStop: "always" }}
                >
                  {true ? (
                    <FeedImage
                      item={a}
                      alt={a.title}
                      eager={i < 2}
                      className="absolute inset-0 h-full w-full"
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
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-black via-black/80 to-transparent" />

                  <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      <span className="rounded-full bg-white/15 px-2.5 py-1 uppercase tracking-wider text-white">
                        {a.category}
                      </span>
                      {fresh && (
                        <span className="rounded-full bg-live px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-live-foreground">
                          Novo
                        </span>
                      )}
                      <span className="min-w-0 truncate text-white/75">{a.source}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-white/70">{timeAgo(a.publishedAt)}</span>
                    </div>
                    <StoryTitle
                      title={a.title}
                      open={openTitle === a.id}
                      onToggle={() => setOpenTitle((current) => (current === a.id ? null : a.id))}
                    />
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <p className="pb-1 text-sm font-semibold text-white">Ler notícia</p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleSave(a);
                          }}
                          aria-label={savedMap[a.id] ? "Guardado" : "Guardar"}
                          className={`flex size-11 items-center justify-center rounded-full ring-1 ring-white/25 ${
                            savedMap[a.id] ? "bg-live text-live-foreground ring-live" : "bg-black/45 text-white"
                          }`}
                        >
                          <Bookmark className={`size-5 ${savedMap[a.id] ? "fill-current" : ""}`} />
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setTab("saved");
                          }}
                          aria-label="Guardadas"
                          className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/25"
                        >
                          <EllipsisVertical className="size-5" />
                        </button>
                      </div>
                    </div>
                  </div>
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

            {query.isFetchingNextPage && (
              <div className="flex w-full items-center justify-center py-6">
                <div className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-live" />
              </div>
            )}

            {query.isSuccess && articles.length > 0 && !query.hasNextPage && (
              <div className="flex w-full snap-start items-center justify-center px-8 py-16 text-center" style={{ scrollSnapStop: "always" }}>
                <p className="text-sm font-medium text-feed-fg/70">
                  Não há mais notícias recentes por agora. Volta daqui a pouco.
                </p>
              </div>
            )}

            </div>
          </div>

          <div ref={mastheadRef} className="pointer-events-none absolute inset-x-0 top-0 z-30 mx-auto max-w-xl">
            <div className="pointer-events-auto bg-feed-bg px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="font-display text-[1.7rem] font-black leading-none tracking-tight text-feed-fg">
                    Flash<span className="text-live">Notícias</span>
                  </h1>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="relative flex size-1.5">
                      <span className="absolute inset-0 animate-live-pulse rounded-full bg-live" />
                      <span className="relative size-1.5 rounded-full bg-live" />
                    </span>
                    <LiveWhen />
                  </div>
                  <LiveDateLine />
                </div>
                <Link
                  to="/contacto"
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-yellow-400 px-3 py-1.5 text-[11px] font-bold text-black"
                >
                  <Phone className="size-3.5" />
                  Contacto
                </Link>
              </div>

              {tickerItems.length > 0 && (
                <div className="mt-2.5 overflow-hidden border-y border-feed-fg/10 py-1.5">
                  <div className="flex w-max animate-ticker items-center whitespace-nowrap">
                    {[...tickerItems, ...tickerItems].map((item, idx) => (
                      <span key={idx} className="px-4 text-[11px] font-medium text-feed-fg/80">
                        {item}
                        <span className="pl-4 text-live">●</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <nav ref={navRef} className="relative mt-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    data-cat={c}
                    onClick={() => {
                      const from = CATEGORIES.indexOf(category);
                      const to = CATEGORIES.indexOf(c);
                      if (to !== from) {
                        setPrevArticles(articlesRef.current);
                        setSlide(to > from ? "left" : "right");
                        window.setTimeout(() => { setSlide(null); setPrevArticles([]); }, 280);
                      }
                      setCategory(c);
                    }}
                    className={`relative z-10 shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                      category === c
                        ? "text-live-foreground"
                        : "text-feed-fg/80"
                    }`}
                  >
                    {c}
                  </button>
                ))}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 h-full rounded-full bg-live"
                  style={{
                    left: indicator.left,
                    width: indicator.width,
                    transition: "left 280ms cubic-bezier(.22,1,.36,1), width 280ms cubic-bezier(.22,1,.36,1)",
                  }}
                />
              </nav>
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
