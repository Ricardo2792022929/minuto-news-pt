import { createFileRoute, Link } from "@tanstack/react-router";
import { INTRO_SRC } from "@/lib/intro-preload";
import { LIGA_CLUBS } from "@/lib/clubs";
import { Onboarding } from "@/components/onboarding";
import { PushAsk } from "@/components/push-ask";
import { imageKitUrl } from "@/lib/imagekit";
import { FeedImage } from "@/components/feed-image";

const TITLE_LINKS = new Set(["da", "de", "do", "das", "dos"]);

/** Quem ou o quê no início do título ("Santos Silva", "Presidente da República", "Banda U2") fica destacado a amarelo. */
function splitTitleLead(title: string): [string, string] {
  const tokens = title.trim().split(/\s+/).filter(Boolean);
  const isName = (token: string) => /^[\p{Lu}\d]/u.test(token);
  let end = 0;
  while (end < tokens.length && end < 4) {
    const token = tokens[end] ?? "";
    if (isName(token)) { end++; continue; }
    if (end > 0 && TITLE_LINKS.has(token.toLowerCase()) && isName(tokens[end + 1] ?? "")) { end++; continue; }
    break;
  }
  // Pelo menos duas palavras ficam fora do destaque; um título só com nomes não leva destaque.
  if (end === 0 || tokens.length - end < 2) return ["", title];
  return [tokens.slice(0, end).join(" "), tokens.slice(end).join(" ")];
}

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
      ? "text-[clamp(1.5rem,6.1vw,1.95rem)]"
      : words > 7
        ? "text-[clamp(1.72rem,7vw,2.25rem)]"
        : "text-[clamp(1.95rem,8vw,2.6rem)]";
  const [lead, rest] = splitTitleLead(title);

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
        className={`mt-2 w-full text-left font-display font-extrabold leading-[1.06] tracking-[-0.025em] text-balance break-words text-feed-fg ${size} ${
          open ? "max-h-[40vh] overflow-y-auto" : "line-clamp-4"
        }`}
        style={{ textShadow: "0 2px 14px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.6)" }}
      >
        {lead ? <span className="text-yellow-400">{lead}</span> : null}
        {lead && rest ? " " : null}
        {rest}
      </h2>
      {overflows && (
        // Espaço que o "Ver mais" ocupava, agora por baixo dos botões: o título fica onde estava e os botões sobem para junto dele.
        <span aria-hidden className="invisible order-last mt-1 block text-left text-[0.8125rem] font-semibold">
          Ver mais
        </span>
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
  ArrowRight,
  Bookmark,
  Check,
  EllipsisVertical,
  Phone,
  Share2,
} from "lucide-react";
import { getNews, type GetNewsResult } from "@/lib/news.functions";
import type { NewsItem } from "@/lib/news.types";
import { storyLabel } from "@/lib/story-label";
import { listenPushOpen, pushPluginReady, registerPush } from "@/lib/push-client";

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
  "Entretenimento",
  "Tech",
] as const;

type Category = (typeof CATEGORIES)[number];

function sectionName(category: Category): string {
  return category === "Tudo" ? "Preferências" : category;
}

const SAVED_KEY = "aominuto:saved";
const INTERESTS_KEY = "aominuto:interests";
const CLUB_KEY = "aominuto:club";
const CLUB_ASKED_KEY = "aominuto:club-asked";

const PAGE_SIZE = 10;

const FEED_CACHE_KEY = "flash:feed-cache";
/** Mais velho do que isto já não vale a pena mostrar enquanto chega o feed novo. */
const FEED_CACHE_MAX_AGE_MS = 6 * 3600_000;

/** 1.ª página do feed guardada neste aparelho, se for das mesmas preferências e recente. */
function readFeedCache(key: string): GetNewsResult | undefined {
  try {
    const raw = localStorage.getItem(FEED_CACHE_KEY);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as { key?: string; at?: number; page?: GetNewsResult };
    if (cached.key !== key || !cached.at || Date.now() - cached.at > FEED_CACHE_MAX_AGE_MS) return undefined;
    return Array.isArray(cached.page?.items) && cached.page.items.length ? cached.page : undefined;
  } catch {
    return undefined;
  }
}

function writeFeedCache(key: string, page: GetNewsResult) {
  try {
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ key, at: Date.now(), page }));
  } catch {
    /* storage cheio ou bloqueado — o feed funciona na mesma */
  }
}

/** Guarda a resposta ao pedido de avisos, venha do fluxo inicial ou do pedido avulso. */
function savePushChoice(on: boolean) {
  try {
    localStorage.setItem("flash:push-asked", "1");
    localStorage.setItem("flash:push-on", on ? "1" : "0");
  } catch {
    /* ignora */
  }
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
    day: "numeric",
    month: "short",
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

/* ---------- Intro (vídeo) ---------- */

function Intro({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const [src] = useState(INTRO_SRC);
  const [visible, setVisible] = useState(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    const hard = window.setTimeout(finish, 7000);
    const close = () => finish();
    const reveal = () => setVisible(true);
    const kick = () => {
      video.muted = true;
      video.defaultMuted = true;
      const playFromStart = () => {
        const attempt = video.play();
        if (!attempt) return;
        attempt.then(reveal).catch(() => {
          video.play().then(reveal).catch(close);
        });
      };
      if (video.currentTime > 0.01) {
        video.addEventListener("seeked", playFromStart, { once: true });
        video.currentTime = 0;
      } else {
        playFromStart();
      }
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
          controls={false}
          disablePictureInPicture
          poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
          className="flash-intro pointer-events-none h-full w-full bg-black object-cover"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: visible ? 1 : 0,
            transition: "opacity 180ms ease",
          }}
          onEnded={finish}
          onError={finish}
        />
      ) : null}
    </div>
  );
}

/* ---------- Abertura de artigos ---------- */

/**
 * Abre o artigo no browser integrado, no endereço original do site.
 * Assim a visita conta e os anúncios do site carregam.
 * O WebView antigo substituía a notícia pelo frame do anúncio e ficava branco.
 */
const ARTICLE_WEBVIEW_AGENT =
  "Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
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
  if (early?.isNativePlatform?.()) void import("@capacitor/share");
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
              <div className="text-[0.625rem] font-bold uppercase tracking-widest text-live">
                {item.source} · {storyLabel(item)}
              </div>
              <h3 className="mt-1.5 font-display text-xl font-bold leading-snug text-balance">
                {item.title}
              </h3>
              <p className="mt-2 text-[0.6875rem] font-medium text-muted-foreground">
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
            className="mt-2 text-[0.6875rem] font-semibold text-muted-foreground hover:text-live"
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
    <span className="text-[0.6875rem] font-semibold text-feed-fg/75">
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
    <p className="min-w-0 truncate text-[0.6875rem] text-feed-fg/70">
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
function PushOk() {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black"
      style={{ animation: "push-ok-out 620ms cubic-bezier(0.23, 1, 0.32, 1) both" }}
    >
      <svg viewBox="0 0 52 52" className="size-28" aria-hidden style={{ animation: "push-ok-in 320ms cubic-bezier(0.23, 1, 0.32, 1) both" }}>
        <path
          d="M14 27.5 22.2 36 39 16"
          fill="none"
          stroke="#fff"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="38"
          strokeDashoffset="38"
          style={{ animation: "check-draw 0.42s cubic-bezier(.65,.05,.36,1) 0.04s forwards" }}
        />
      </svg>
    </div>
  );
}

function Index() {
  useLockedFeedHeight();
  const [mounted, setMounted] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [club, setClub] = useState("");
  const [arrival, setArrival] = useState<string | null>(null);
  // Fade do feed pedido no fim do "Tudo pronto": só arranca quando as notícias já estão no ecrã
  // (com os temas e o clube novos há um carregamento; antes o fade corria por cima do "a carregar").
  const [fadePending, setFadePending] = useState(false);
  const pendingArrival = useRef<string | null>(null);
  const arrivalPlayed = useRef(false);
  const [premiere, setPremiere] = useState(false);
  const [askPush, setAskPush] = useState(false);
  const [pushOk, setPushOk] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const openReaderRef = useRef<(url: string) => void>(() => {});
  openReaderRef.current = (raw) => {
    const url = cleanUrl(raw);
    void (async () => {
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (cap?.isNativePlatform?.()) {
        try {
          const { Capacitor, registerPlugin } = await import("@capacitor/core");
          if (Capacitor.isPluginAvailable("ArticleBrowser")) {
            const ArticleBrowser = registerPlugin<{ open(options: { url: string }): Promise<void> }>("ArticleBrowser");
            await ArticleBrowser.open({ url });
            return;
          }
        } catch {
          /* AAB antigo ainda não tem este browser */
        }
        try {
          const { InAppBrowser, DefaultWebViewOptions } = await import("@capacitor/inappbrowser");
          await InAppBrowser.openInWebView({
            url,
            options: {
              ...DefaultWebViewOptions,
              showURL: false,
              showToolbar: true,
              closeButtonText: "Voltar",
              showNavigationButtons: true,
              clearCache: false,
              clearSessionCache: false,
              customWebViewUserAgent: ARTICLE_WEBVIEW_AGENT,
              android: {
                ...DefaultWebViewOptions.android,
                hardwareBack: true,
                allowZoom: false,
                isIsolated: false,
              },
            },
          });
          return;
        } catch {
          /* a versão antiga da app ainda não tem o browser interno */
        }
        try {
          const { Browser } = await import("@capacitor/browser");
          await Browser.open({ url });
          return;
        } catch {
          /* abre no separador */
        }
      }
      window.open(url, "_blank", "noopener");
    })();
  };
  const closeIntro = useCallback(() => {
    try {
      sessionStorage.setItem("flash:intro-seen", "1");
    } catch {
      /* ignora */
    }
    setShowIntro(false);
  }, []);

  const playArrival = useCallback(() => {
    if (arrivalPlayed.current) return;
    const name = pendingArrival.current;
    if (!name) return;
    arrivalPlayed.current = true;
    pendingArrival.current = null;
    setArrival(name);
    window.setTimeout(() => setArrival(null), 1500);
  }, []);

  useEffect(() => {
    if (!mounted || showIntro || showOnboarding) return;
    let cancelled = false;
    void (async () => {
      const ready = await pushPluginReady();
      if (cancelled) return;
      if (!ready) {
        playArrival();
        return;
      }
      listenPushOpen((url) => openReaderRef.current(url));
      let asked = false;
      let on = false;
      try {
        asked = localStorage.getItem("flash:push-asked") === "1";
        on = localStorage.getItem("flash:push-on") === "1";
      } catch {
        /* ignora */
      }
      if (on) {
        void registerPush().catch(() => {});
        playArrival();
        return;
      }
      if (!asked) setAskPush(true);
      else playArrival();
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, showIntro, showOnboarding, playArrival]);

  const acceptPush = useCallback(async () => {
    setPushBusy(true);
    let on = false;
    try {
      on = await registerPush();
    } catch {
      on = false;
    }
    savePushChoice(on);
    setPushBusy(false);
    if (!on) {
      setAskPush(false);
      playArrival();
      return;
    }
    setPushOk(true);
    window.setTimeout(() => {
      playArrival();
      setPushOk(false);
      setAskPush(false);
    }, 620);
  }, [playArrival]);

  const declinePush = useCallback(() => {
    savePushChoice(false);
    setAskPush(false);
    playArrival();
  }, [playArrival]);

  // O passo dos avisos aparece sempre na primeira utilização. Só pede a autorização a sério
  // quando o telemóvel suporta notificações; no browser ou na pré-visualização apenas avança.
  const pushHooks = useMemo(
    () => ({
      enable: async () => {
        if (!(await pushPluginReady())) return false;
        let on = false;
        try {
          on = await registerPush();
        } catch {
          on = false;
        }
        savePushChoice(on);
        return on;
      },
      decline: () => {
        void pushPluginReady().then((ready) => {
          if (ready) savePushChoice(false);
        });
      },
    }),
    [],
  );

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
  const [sourceStory, setSourceStory] = useState<NewsItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
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
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      const nativeIntro =
        new URLSearchParams(window.location.search).has("nativeIntro") ||
        Boolean(cap?.isNativePlatform?.()) ||
        /\bwv\b/.test(navigator.userAgent || "");
      if (nativeIntro) sessionStorage.setItem("flash:intro-seen", "1");
      setShowIntro(!nativeIntro && sessionStorage.getItem("flash:intro-seen") !== "1");
    } catch {
      setShowIntro(false);
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

  const shareStory = useCallback(async (item: NewsItem) => {
    const url = cleanUrl(item.url);
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.()) {
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({
          title: item.title,
          text: item.title,
          url,
          dialogTitle: "Partilhar notícia",
        });
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (/cancel/i.test(message)) return;
      }
    }
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, text: item.title, url });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(item.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === item.id ? null : current));
      }, 1600);
    } catch {
      /* o browser bloqueou a cópia */
    }
  }, []);

  // Última 1.ª página guardada neste aparelho: mostra-se logo ao abrir (durante a intro já está pronta)
  // enquanto o pedido novo corre; quando chega, substitui-a.
  const feedCacheKey = `${category}|${interests.join(",")}|${club}`;
  const query = useInfiniteQuery({
    queryKey: ["news", category, interests.join(","), club, premiere],
    enabled: mounted,
    refetchInterval: 60_000,
    placeholderData: () => {
      if (!mounted) return undefined;
      const page = readFeedCache(feedCacheKey);
      return page ? { pages: [page], pageParams: [0] } : undefined;
    },
    queryFn: ({ pageParam }) =>
      fetchNews({ data: { offset: pageParam, limit: PAGE_SIZE, category: category === "Tudo" ? undefined : category, interests, club: club || undefined, premiere: premiere && pageParam === 0 && category === "Tudo" } }),
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
    // Com a página guardada ainda no ecrã, não pedir a seguinte: cancelava o pedido da 1.ª página nova.
    if (hasMoreRef.current && !query.isPlaceholderData) void query.fetchNextPage();
  };
  hasMoreRef.current = Boolean(query.hasNextPage);

  useEffect(() => {
    if (!mounted || tab !== "feed" || query.isPlaceholderData) return;
    if (articles.length < 12 && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [mounted, tab, articles.length, query.hasNextPage, query.isFetchingNextPage, query]);

  // Guarda a 1.ª página nova para a próxima abertura da app.
  const firstPage = query.isPlaceholderData ? undefined : query.data?.pages[0];
  useEffect(() => {
    if (firstPage?.items.length) writeFeedCache(feedCacheKey, firstPage);
  }, [firstPage, feedCacheKey]);

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
    if (!mounted) return;
    const index = CATEGORIES.indexOf(category);
    const neighbors = [CATEGORIES[index - 1], CATEGORIES[index + 1]].filter(
      (item): item is (typeof CATEGORIES)[number] => Boolean(item),
    );
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
            return CATEGORIES[dir === "left" ? Math.min(index + 1, CATEGORIES.length - 1) : Math.max(index - 1, 0)] ?? current;
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
        if (item) openReaderRef.current(item.url);
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
  }, [tab, mounted, category]);

  const isError = query.isError;

  useEffect(() => {
    if (!fadePending) return;
    if (articles.length > 0) {
      setFadePending(false);
      setArrival("feed");
      window.setTimeout(() => setArrival(null), 1000);
      return;
    }
    // Se as notícias demorarem muito, desiste do fade (o feed aparece normalmente).
    const giveUp = window.setTimeout(() => setFadePending(false), 10_000);
    return () => window.clearTimeout(giveUp);
  }, [fadePending, articles.length]);

  if (!mounted) {
    return (
      <div className="mx-auto h-[var(--feed-h,100svh)] w-full max-w-xl bg-transparent" />
    );
  }

  return (
    <div className="relative mx-auto h-[var(--feed-h,100svh)] w-full max-w-xl overflow-hidden bg-feed-bg">
      {showIntro && <Intro onDone={closeIntro} />}
      {askPush && !showIntro && !showOnboarding && (
        <PushAsk busy={pushBusy} onYes={() => void acceptPush()} onNo={declinePush} />
      )}
      {pushOk && <PushOk />}
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
            // Depois do "Tudo pronto", o feed abre sempre com a animação de entrada (com ou sem clube).
            // O feed entra logo, no mesmo instante em que o "Tudo pronto" sai (sem esperar pelos avisos).
            pendingArrival.current = null;
            arrivalPlayed.current = true;
            setFadePending(true);
            setShowOnboarding(false);
            setPremiere(true);
          }}
          onLater={() => setShowOnboarding(false)}
          push={pushHooks}
        />
      )}

      {tab === "feed" ? (
        <>
          {/* Feed */}
          <div
            className={`absolute inset-0 z-0 overflow-hidden ${arrival ? "feed-arrive" : ""}`}
            style={
              arrival
                ? undefined
                : askPush || pushOk
                  ? { visibility: "hidden" }
                  : undefined
            }
          >
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
                      <FeedImage item={preview} alt="" fill className="h-full w-full" />
                      <div className="absolute inset-0 feed-scrim" />
                      <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-8">
                        <h2 className="font-display text-2xl font-bold text-white">{preview.title}</h2>
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-white/60">
                      <span className="text-sm font-semibold uppercase tracking-widest">
                        {(() => {
                          const neighbor = CATEGORIES[CATEGORIES.indexOf(category) + (dragX < 0 ? 1 : -1)];
                          return neighbor ? sectionName(neighbor) : "";
                        })()}
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
                  className="feed-card relative flex w-full snap-start snap-always flex-col overflow-hidden bg-black"
                  style={{ height: "var(--feed-h, 100svh)", minHeight: "var(--feed-h, 100svh)" }}
                >
                  {true ? (
                    <FeedImage
                      item={a}
                      alt={a.title}
                      eager={i < 2}
                      fill
                      className="h-full w-full"
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

                  <div className={`relative z-10 mt-auto flex flex-col bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pt-10 pb-[max(1rem,env(safe-area-inset-bottom))]`}>
                    <div className="flex items-center gap-2 text-[0.6875rem] font-semibold">
                      <span className={`shrink-0 rounded-full px-3 py-1.5 text-[0.8125rem] font-black tabular-nums tracking-tight ${fresh ? "bg-live text-live-foreground" : "bg-white text-black"}`}>
                        {timeAgo(a.publishedAt)} · {formatClock(new Date(a.publishedAt))}
                      </span>
                      <span className="rounded-full bg-white/15 px-2.5 py-1 uppercase tracking-wider text-white">
                        {storyLabel(a)}
                      </span>
                      <span className="min-w-0 truncate text-white/75">{a.source}</span>
                      {(a.sources?.length ?? 0) > 1 ? (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSourceStory(a);
                          }}
                          className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-white"
                        >
                          {a.sources!.length} fontes
                        </button>
                      ) : null}
                    </div>
                    <StoryTitle
                      title={a.title}
                      open={openTitle === a.id}
                      onToggle={() => setOpenTitle((current) => (current === a.id ? null : a.id))}
                    />
                    <div className="mt-3 flex translate-y-1.5 items-center justify-between gap-3">
                      <p className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white pl-3.5 pr-3 text-[0.8125rem] font-bold text-black shadow-lg shadow-black/30">
                        Ler notícia
                        <ArrowRight className="size-3.5" />
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void shareStory(a);
                          }}
                          aria-label={copiedId === a.id ? "Link copiado" : "Partilhar"}
                          className="flex size-11 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-[0.92] motion-reduce:transition-none bg-black/45 text-white ring-1 ring-white/25"
                        >
                          {copiedId === a.id ? <Check className="size-5" /> : <Share2 className="size-5" />}
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleSave(a);
                          }}
                          aria-label={savedMap[a.id] ? "Guardado" : "Guardar"}
                          className={`flex size-11 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-[0.92] motion-reduce:transition-none ring-1 ring-white/25 ${
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
                          className="flex size-11 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-[0.92] motion-reduce:transition-none bg-black/45 text-white ring-1 ring-white/25"
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

            {mounted && !isError && !articles.length && !query.isSuccess && (
              <div
                role="status"
                aria-label="A carregar notícias"
                className="flex w-full items-center justify-center"
                style={{ height: "var(--feed-h, 100svh)" }}
              >
                <div className="size-9 animate-spin rounded-full border-2 border-white/20 border-t-live" />
              </div>
            )}

            {query.isSuccess && !isError && !articles.length && (
              <div className="flex w-full items-center justify-center px-8 text-center" style={{ height: "var(--feed-h, 100svh)" }}>
                <p className="font-display text-lg font-bold text-feed-fg/80">
                  {category === "Tudo" ? "Sem notícias recentes nas últimas 24h" : "Sem notícias nesta secção por agora"}
                </p>
              </div>
            )}

            {query.isFetchingNextPage && (
              <div className="flex w-full items-center justify-center py-6">
                <div className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-live" />
              </div>
            )}

            {query.isSuccess && articles.length >= 8 && !query.hasNextPage && (
              <div className="flex w-full snap-start items-center justify-center px-8 py-16 text-center" style={{ scrollSnapStop: "always" }}>
                <p className="text-sm font-medium text-feed-fg/70">
                  {category === "Tudo"
                    ? "Não há mais notícias recentes por agora. Volta daqui a pouco."
                    : "Não há mais notícias nesta secção por agora."}
                </p>
              </div>
            )}

            </div>
          </div>

          {sourceStory && (sourceStory.sources?.length ?? 0) > 1 ? (
            <div className="absolute inset-0 z-40 bg-black/55" onClick={() => setSourceStory(null)}>
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-neutral-950 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 ring-1 ring-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
                <p className="mb-3 text-sm font-semibold text-white/70">A mesma notícia</p>
                <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                  {sourceStory.sources!.map((link) => (
                    <button
                      key={link.url}
                      type="button"
                      onClick={() => {
                        setSourceStory(null);
                        openReaderRef.current(link.url);
                      }}
                      className="rounded-2xl bg-white/10 px-3 py-3 text-left"
                    >
                      <span className="block text-[0.6875rem] font-bold uppercase tracking-wider text-white/60">{link.source}</span>
                      <span className="mt-1 block text-sm font-semibold text-white">{link.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className={`pointer-events-none absolute inset-x-0 top-0 z-30 mx-auto max-w-xl ${arrival ? "feed-arrive" : ""} bg-gradient-to-b from-black/70 via-black/30 to-transparent pb-8`}>
            <div className="px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <div className="flex items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-black leading-none tracking-tight text-feed-fg">
                  Flash<span className="text-live">Notícias</span>
                </h1>
                <Link
                  to="/contacto"
                  className="pointer-events-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-yellow-400 px-3 text-[0.6875rem] font-bold text-black"
                >
                  <Phone className="size-3.5" />
                  Contacto
                </Link>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="relative flex size-1.5 shrink-0">
                  <span className="absolute inset-0 animate-live-pulse rounded-full bg-live" />
                  <span className="relative size-1.5 rounded-full bg-live" />
                </span>
                <LiveWhen />
                <span className="text-feed-fg/35">·</span>
                <LiveDateLine />
              </div>

              <nav ref={navRef} className="pointer-events-auto relative mt-2.5 flex h-8 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                    className={`relative z-10 flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold transition-colors duration-200 ${
                      category === c
                        ? "text-live-foreground"
                        : "bg-feed-bg/55 text-feed-fg"
                    }`}
                  >
                    {sectionName(c)}
                  </button>
                ))}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 h-full rounded-full bg-live motion-reduce:transition-none"
                  style={{
                    // transform em vez de "left": corre na GPU, sem recalcular a página a cada fotograma.
                    transform: `translateX(${indicator.left}px)`,
                    width: indicator.width,
                    transition: "transform 260ms cubic-bezier(0.645, 0.045, 0.355, 1), width 260ms cubic-bezier(0.645, 0.045, 0.355, 1)",
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
          onOpen={(item) => openReaderRef.current(item.url)}
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
