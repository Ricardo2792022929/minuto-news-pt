import { createFileRoute, Link } from "@tanstack/react-router";
import { INTRO_SRC } from "@/lib/intro-preload";
import { LIGA_CLUBS } from "@/lib/clubs";
import paperBall from "@/assets/paper-ball.jpg";
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
  Check,
  Cpu,
  EllipsisVertical,
  Globe,
  Landmark,
  Palette,
  Phone,
  Share2,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { getNews, type GetNewsResult } from "@/lib/news.functions";
import type { NewsItem } from "@/lib/news.types";
import { storyLabel } from "@/lib/story-label";

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
  { category: "Entretenimento", label: "Entretenimento", icon: <Sparkles className="size-5" /> },
  { category: "Tech", label: "Tech", icon: <Cpu className="size-5" /> },
];

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

function ClubMark({ id }: { id: string }) {
  const mark =
    id === "porto" ? { letters: "P", bg: "#0038A8" }
    : id === "benfica" ? { letters: "B", bg: "#E30613" }
    : { letters: "S", bg: "#008057" };
  return (
    <span
      className="mb-auto flex size-11 items-center justify-center rounded-2xl text-lg font-black text-white"
      style={{ background: mark.bg }}
      aria-hidden
    >
      {mark.letters}
    </span>
  );
}

function Onboarding({
  onDone,
  onLater,
}: {
  onDone: (interests: string[], club: string | null) => void;
  onLater: () => void;
}) {
  const helloWord = greeting();
  const askLine = "Que tipo de notícias gostas de ver?";
  const clubLine = "Selecione o seu clube favorito";
  const [phase, setPhase] = useState<"greet" | "erase" | "ask" | "club">("greet");
  const [greetBeat, setGreetBeat] = useState(0);
  const [shownIcons, setShownIcons] = useState(0);
  const [shownClubs, setShownClubs] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pendingClub, setPendingClub] = useState<string | null>(null);
  const [curtain, setCurtain] = useState<"off" | "in" | "out">("off");
  const clubTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (clubTimer.current) window.clearTimeout(clubTimer.current);
  }, []);

  useEffect(() => {
    if (phase !== "greet") return;
    const lead = 700;
    const letters = lead + helloWord.length * 150 + 1600;
    const line = window.setTimeout(() => setGreetBeat(1), letters);
    const note = window.setTimeout(() => setGreetBeat(2), letters + 1600);
    const fresh = window.setTimeout(() => setGreetBeat(3), letters + 3200);
    const leave = window.setTimeout(() => setPhase("erase"), letters + 7600);
    return () => {
      window.clearTimeout(line);
      window.clearTimeout(note);
      window.clearTimeout(fresh);
      window.clearTimeout(leave);
    };
  }, [phase, helloWord]);

  useEffect(() => {
    if (phase !== "erase") return;
    const id = window.setTimeout(() => setPhase("ask"), 1200);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "ask") return;
    let count = 0;
    const id = window.setInterval(() => {
      count += 1;
      setShownIcons(count);
      if (count >= INTEREST_OPTIONS.length) window.clearInterval(id);
    }, 140);
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
    }, 70);
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
    clubTimer.current = window.setTimeout(() => onDone([...picked], id), 1400);
  };

  const goClub = () => {
    if (picked.size === 0 || curtain !== "off") return;
    setCurtain("in");
    window.setTimeout(() => {
      setPhase("club");
      setCurtain("out");
    }, 460);
    window.setTimeout(() => setCurtain("off"), 1080);
  };

  const step = phase === "club" ? 2 : 1;

  return (
    <div className="fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-black text-feed-fg">
      <div className="pointer-events-none absolute -left-16 top-0 size-80 rounded-full bg-live/20 blur-3xl" style={{ animation: "light-drift 9s ease-in-out infinite" }} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.55)_100%)]" />
      {phase === "greet" || phase === "erase" ? (
        <div
          className={`relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-black px-8 text-center transition-opacity duration-[1200ms] ease-out ${
            phase === "erase" ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[12vh] bg-gradient-to-b from-black to-transparent" />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[12vh] bg-gradient-to-t from-black to-transparent" />
          <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.72)_80%)]" />
          <span className="pointer-events-none absolute size-[28rem] rounded-full bg-live/20 blur-3xl animate-greet-glow" />
          <span
            className="relative mb-10 text-[11px] font-semibold uppercase tracking-[0.45em] text-feed-fg/70"
            style={{ animation: "greet-fade 1.4s ease 0.2s both" }}
          >
            Flash Notícias
          </span>
          <h1 className="relative overflow-hidden font-display text-6xl font-black leading-none tracking-tight">
            {helloWord.split("").map((letter, index) => (
              <span
                key={`${letter}-${index}`}
                className="inline-block"
                style={{
                  animation: "greet-letter 1.05s cubic-bezier(.22,1,.36,1) both",
                  animationDelay: `${700 + index * 150}ms`,
                }}
              >
                {letter === " " ? "\u00A0" : letter}
              </span>
            ))}
            <span
              className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent"
              style={{ animation: "greet-sweep 2.2s ease-in-out 1.1s both" }}
            />
          </h1>
          <span
            className="relative mt-8 h-px w-24 origin-center bg-live"
            style={{
              animation: greetBeat >= 1 ? "greet-line 1.1s cubic-bezier(.22,1,.36,1) both" : undefined,
              transform: greetBeat >= 1 ? undefined : "scaleX(0)",
            }}
          />
          <p
            className="relative mt-6 max-w-xs font-display text-lg font-semibold leading-snug tracking-wide text-balance text-feed-fg/90"
            style={{
              opacity: greetBeat >= 1 ? 1 : 0,
              transform: greetBeat >= 1 ? "translateY(0)" : "translateY(18px)",
              filter: greetBeat >= 1 ? "blur(0)" : "blur(8px)",
              transition: "opacity 1100ms ease, transform 1100ms cubic-bezier(.22,1,.36,1), filter 1100ms ease",
            }}
          >
            Bem-vindo à Flash Notícias Portugal.
          </p>
          <p
            className="relative mt-4 max-w-xs text-sm leading-relaxed tracking-wide text-feed-fg/55"
            style={{
              opacity: greetBeat >= 2 ? 1 : 0,
              transform: greetBeat >= 2 ? "translateY(0)" : "translateY(14px)",
              transition: "opacity 1200ms ease, transform 1200ms cubic-bezier(.22,1,.36,1)",
            }}
          >
            As notícias são sempre as mais recentes.
          </p>
          <p
            className="relative mt-4 max-w-xs text-sm leading-relaxed tracking-wide text-feed-fg/55"
            style={{
              opacity: greetBeat >= 3 ? 1 : 0,
              transform: greetBeat >= 3 ? "translateY(0)" : "translateY(14px)",
              transition: "opacity 1200ms ease, transform 1200ms cubic-bezier(.22,1,.36,1)",
            }}
          >
            Um feed curto, feito para o telemóvel.
          </p>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <p className="pointer-events-none absolute right-4 top-[max(0.5rem,env(safe-area-inset-top))] font-display text-7xl font-black leading-none text-feed-fg/[0.06]">
            {step === 1 ? "01" : "02"}
          </p>
          {phase === "ask" ? (
            <div className="relative flex min-h-0 flex-1 flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[max(4.5rem,env(safe-area-inset-top))]" style={{ animation: "scene-in 0.9s cubic-bezier(.22,1,.36,1) both" }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-live">Os teus temas</p>
              <h1 className="mt-3 max-w-[16rem] font-display text-4xl font-black leading-[0.95] text-balance">
                {askLine}
              </h1>
              <div className="mt-6 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {INTEREST_OPTIONS.map((opt, index) => {
                  const active = picked.has(opt.category);
                  const visible = index < shownIcons;
                  return (
                    <button
                      key={opt.category}
                      onClick={() => visible && toggle(opt.category)}
                      className={`flex min-h-[4.25rem] items-center gap-4 rounded-2xl border px-4 text-left active:scale-[0.99] ${
                        active
                          ? "border-live bg-live text-live-foreground"
                          : "border-white/10 bg-white/[0.04] text-feed-fg"
                      }`}
                      aria-pressed={active}
                      aria-hidden={!visible}
                      tabIndex={visible ? 0 : -1}
                      style={{
                        animation: !visible
                          ? undefined
                          : active
                            ? "select-glow 0.45s cubic-bezier(.22,1,.36,1)"
                            : "pick-in 0.7s cubic-bezier(.22,1,.36,1) both",
                        opacity: visible ? 1 : 0,
                      }}
                    >
                      <span className={`w-6 font-display text-lg font-black ${active ? "text-live-foreground/70" : "text-feed-fg/35"}`}>
                        0{index + 1}
                      </span>
                      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${active ? "bg-black/15" : "bg-white/10"}`}>
                        {opt.icon}
                      </span>
                      <span className="text-base font-semibold">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              <div
                className={`mt-4 flex items-center justify-between gap-3 transition-all duration-700 ${
                  shownIcons >= INTEREST_OPTIONS.length ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
                }`}
              >
                <button onClick={onLater} className="rounded-full px-3 py-3 text-sm font-semibold text-feed-fg/55">
                  Agora não
                </button>
                <button
                  onClick={goClub}
                  disabled={picked.size === 0}
                  className={`min-h-12 rounded-full px-7 py-3 text-sm font-bold transition-transform active:scale-[0.98] ${
                    picked.size ? "bg-live text-live-foreground" : "cursor-not-allowed bg-white/10 text-feed-fg/35"
                  }`}
                >
                  Continuar
                </button>
              </div>
            </div>
          ) : (
            <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[max(4.5rem,env(safe-area-inset-top))]" style={{ animation: "scene-in 0.9s cubic-bezier(.22,1,.36,1) both" }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-live">O teu clube</p>
              <h1 className="mt-3 max-w-[16rem] font-display text-4xl font-black leading-[0.95] text-balance">
                {clubLine}
              </h1>
              <div className="mt-5 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="grid grid-cols-3 gap-2">
                  {LIGA_CLUBS.slice(0, 3).map((club, index) => {
                    const shown = index < shownClubs;
                    const selected = pendingClub === club.id;
                    return (
                      <button
                        key={club.id}
                        onClick={() => shown && chooseClub(club.id)}
                        disabled={pendingClub !== null}
                        className={`flex min-h-28 flex-col items-start justify-between rounded-2xl px-3 py-3 text-left ${
                          selected ? "bg-live text-live-foreground" : "bg-white/[0.06] text-feed-fg"
                        }`}
                        style={{
                          animation: !shown
                            ? undefined
                            : selected
                              ? "select-glow 0.45s cubic-bezier(.22,1,.36,1)"
                              : "pick-in 0.8s cubic-bezier(.22,1,.36,1) both",
                          opacity: shown ? 1 : 0,
                        }}
                      >
                        <ClubMark id={club.id} />
                        <span className="font-display text-lg font-black leading-none">{club.name.replace("FC ", "")}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {LIGA_CLUBS.slice(3).map((club, index) => {
                    const shown = index + 3 < shownClubs;
                    const selected = pendingClub === club.id;
                    return (
                      <button
                        key={club.id}
                        onClick={() => shown && chooseClub(club.id)}
                        disabled={pendingClub !== null}
                        className={`flex min-h-12 items-center rounded-2xl px-4 text-left text-sm font-semibold ${
                          selected ? "bg-live text-live-foreground" : "bg-white/[0.04] text-feed-fg"
                        }`}
                        style={{
                          animation: shown ? "pick-in 0.65s cubic-bezier(.22,1,.36,1) both" : undefined,
                          opacity: shown ? 1 : 0,
                        }}
                      >
                        {club.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={() => onDone([...picked], null)}
                className="mt-2 min-h-11 shrink-0 text-sm font-semibold tracking-wide text-feed-fg/55"
              >
                Continuar sem clube
              </button>
              {pendingClub ? (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black px-8 text-center" style={{ animation: "scene-in 0.55s cubic-bezier(.22,1,.36,1) both" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-feed-fg/60">O teu clube</p>
                  <h2 className="mt-4 font-display text-5xl font-black leading-none" style={{ animation: "greet-letter 0.8s cubic-bezier(.22,1,.36,1) both" }}>
                    {LIGA_CLUBS.find((club) => club.id === pendingClub)?.name}
                  </h2>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
      {curtain !== "off" ? (
        <div
          className="pointer-events-none absolute inset-0 z-50 origin-center bg-black"
          style={{
            animation: curtain === "in"
              ? "curtain-in 0.45s cubic-bezier(.7,0,.3,1) both"
              : "curtain-out 0.55s cubic-bezier(.22,1,.36,1) both",
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------- Abertura de artigos ---------- */

/**
 * Abre o artigo no browser integrado da app.
 * O WebView não se identifica como browser interno e não apaga os cookies,
 * senão vários sites de notícias abrem uma página branca.
 */
const ARTICLE_WEBVIEW_AGENT =
  "Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
// Limpa e valida o URL vindo do feed RSS: remove espaços e carateres
// inválidos no fim e garante que começa sempre por https://.
function articleWebUrl(raw: string): string {
  const url = cleanUrl(raw);
  try {
    const page = new URL(url);
    if (!page.hostname.endsWith("iol.pt")) return url;
    const reader = new URL("/api/public/reader", window.location.origin);
    reader.searchParams.set("u", page.href);
    return reader.href;
  } catch {
    return url;
  }
}

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
              <div className="text-[10px] font-bold uppercase tracking-widest text-live">
                {item.source} · {storyLabel(item)}
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
    <p className="min-w-0 truncate text-[11px] text-feed-fg/70">
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
  const [arrival, setArrival] = useState<string | null>(null);
  const [premiere, setPremiere] = useState(false);
  const openReaderRef = useRef<(url: string) => void>(() => {});
  openReaderRef.current = (raw) => {
    const url = articleWebUrl(raw);
    void (async () => {
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (cap?.isNativePlatform?.()) {
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
      const nativeIntro = new URLSearchParams(window.location.search).has("nativeIntro");
      if (nativeIntro) sessionStorage.setItem("flash:intro-seen", "1");
      setShowIntro(!nativeIntro && sessionStorage.getItem("flash:intro-seen") !== "1");
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

  const query = useInfiniteQuery({
    queryKey: ["news", category, interests.join(","), club, premiere],
    enabled: mounted,
    refetchInterval: 60_000,
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
                const name = LIGA_CLUBS.find((item) => item.id === chosen)?.name ?? chosen;
                setArrival(name);
                window.setTimeout(() => setArrival(null), 1500);
              }
            } catch {
              /* ignora */
            }
            setShowOnboarding(false);
            setPremiere(true);
          }}
          onLater={() => setShowOnboarding(false)}
        />
      )}
      {arrival ? (
        <div className="pointer-events-none absolute inset-0 z-[90]" style={{ perspective: "680px" }}>
          <div
            className="absolute left-1/2 top-[56%] aspect-square w-64 [transform-style:preserve-3d]"
            style={{ animation: "ball-tumble 1.35s cubic-bezier(.55,.04,.25,1) forwards" }}
          >
            <img src={paperBall} alt="" className="size-full rounded-full object-cover shadow-[0_28px_30px_rgba(0,0,0,0.5)]" />
            <span
              className="absolute inset-0 rounded-full"
              style={{ background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.34), transparent 36%, rgba(0,0,0,0.42) 78%)" }}
            />
          </div>
        </div>
      ) : null}

      {tab === "feed" ? (
        <>
          {/* Feed */}
          <div
            className="absolute inset-0 z-0 overflow-hidden"
            style={arrival ? { animation: "feed-unfold 1.35s cubic-bezier(.55,.05,.25,1) both", transformOrigin: "50% 56%" } : undefined}
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

                  <div className="relative z-10 mt-auto bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pt-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      <span className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-black tabular-nums tracking-tight ${fresh ? "bg-live text-live-foreground" : "bg-white text-black"}`}>
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
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">Ler notícia</p>
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
                          className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/25"
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
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-white/60">{link.source}</span>
                      <span className="mt-1 block text-sm font-semibold text-white">{link.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 mx-auto max-w-xl bg-gradient-to-b from-black/70 via-black/30 to-transparent pb-8">
            <div className="px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <div className="flex items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-black leading-none tracking-tight text-feed-fg">
                  Flash<span className="text-live">Notícias</span>
                </h1>
                <Link
                  to="/contacto"
                  className="pointer-events-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-yellow-400 px-3 text-[11px] font-bold text-black"
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
