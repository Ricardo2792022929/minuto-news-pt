import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  Cpu,
  Globe,
  Landmark,
  Palette,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { LIGA_CLUBS, clubInitials } from "@/lib/clubs";

type Step = "welcome" | "topics" | "club" | "done";

const TOPICS: { category: string; label: string; icon: ReactNode }[] = [
  { category: "Política", label: "Política", icon: <Landmark className="size-5" /> },
  { category: "Economia", label: "Economia", icon: <TrendingUp className="size-5" /> },
  { category: "Desporto", label: "Desporto", icon: <Trophy className="size-5" /> },
  { category: "Mundo", label: "Mundo", icon: <Globe className="size-5" /> },
  { category: "Cultura", label: "Cultura", icon: <Palette className="size-5" /> },
  { category: "Entretenimento", label: "Entretenimento", icon: <Sparkles className="size-5" /> },
  { category: "Tech", label: "Tech", icon: <Cpu className="size-5" /> },
];

/** A boas-vindas avança sozinha, mas um toque em "Começar" salta logo. */
const WELCOME_MS = 3200;
/** Confirmação final curta antes de entregar as escolhas à app. */
const DONE_MS = 900;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 20) return "Boa tarde";
  return "Boa noite";
}

function tick() {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* sem vibração neste dispositivo */
  }
}

function delay(index: number, step = 45, max = 14): { animationDelay: string } {
  return { animationDelay: `${Math.min(index, max) * step}ms` };
}

function Header({
  index,
  onBack,
  onSkip,
}: {
  index: 0 | 1;
  onBack?: () => void;
  onSkip?: () => void;
}) {
  return (
    <div className="relative px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="flex h-12 items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar"
            className="flex size-12 items-center justify-center rounded-full text-feed-fg active:bg-white/10"
          >
            <ArrowLeft className="size-5" />
          </button>
        ) : (
          <span className="size-12" aria-hidden />
        )}
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="flex min-h-12 items-center rounded-full px-3 text-sm font-semibold text-feed-fg/60 active:bg-white/10"
          >
            Agora não
          </button>
        ) : null}
      </div>
      <div
        className="flex gap-1.5 px-2"
        role="progressbar"
        aria-label={`Passo ${index + 1} de 2`}
        aria-valuemin={1}
        aria-valuemax={2}
        aria-valuenow={index + 1}
      >
        {[0, 1].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= index ? "bg-live" : "bg-white/15"}`}
          />
        ))}
      </div>
    </div>
  );
}

function Title({ eyebrow, title, hint }: { eyebrow: string; title: string; hint: string }) {
  return (
    <div className="px-6 pt-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-live">{eyebrow}</p>
      <h1 className="mt-2 max-w-[18rem] font-display text-[2rem] font-black leading-[1.05] text-balance">
        {title}
      </h1>
      <p className="mt-2 text-sm text-feed-fg/60">{hint}</p>
    </div>
  );
}

const footerClass =
  "px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-1px_0_rgba(255,255,255,0.06)]";
const scrollClass =
  "min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-6 pb-4 pt-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export function Onboarding({
  onDone,
  onLater,
}: {
  onDone: (interests: string[], club: string | null) => void;
  onLater: () => void;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const [hello] = useState(greeting);
  const [picked, setPicked] = useState<string[]>([]);
  const [clubId, setClubId] = useState<string | null>(null);

  // O pai recria onDone a cada render; a ref evita reiniciar o temporizador.
  const latest = useRef({ onDone, picked, clubId });
  latest.current = { onDone, picked, clubId };
  const finished = useRef(false);

  useEffect(() => {
    if (step !== "welcome") return;
    const id = window.setTimeout(() => setStep("topics"), WELCOME_MS);
    return () => window.clearTimeout(id);
  }, [step]);

  useEffect(() => {
    if (step !== "done") return;
    const id = window.setTimeout(() => {
      if (finished.current) return;
      finished.current = true;
      const { onDone: done, picked: topics, clubId: club } = latest.current;
      done(topics, club);
    }, DONE_MS);
    return () => window.clearTimeout(id);
  }, [step]);

  const toggleTopic = (category: string) => {
    tick();
    setPicked((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category],
    );
  };

  const chooseClub = (id: string) => {
    tick();
    setClubId((prev) => (prev === id ? null : id));
  };

  const club = LIGA_CLUBS.find((item) => item.id === clubId) ?? null;

  return (
    <div className="fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-black text-feed-fg [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]">
      {/* Brilho estático: um gradiente é muito mais barato que um blur animado. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 42% at 50% 0%, color-mix(in oklab, var(--live) 30%, transparent), transparent 70%)",
        }}
      />

      {step === "welcome" ? (
        <div className="relative flex flex-1 flex-col items-center justify-center px-8 pb-[env(safe-area-inset-bottom)] text-center">
          <span className="ob-rise text-[11px] font-semibold uppercase tracking-[0.4em] text-feed-fg/70">
            Flash Notícias
          </span>
          <h1
            className="ob-rise mt-6 font-display text-6xl font-black leading-none tracking-tight"
            style={delay(3, 40)}
          >
            {hello}
          </h1>
          <p
            className="ob-rise mt-5 max-w-xs font-display text-lg font-semibold leading-snug text-balance text-feed-fg/90"
            style={delay(6, 40)}
          >
            Bem-vindo à Flash Notícias Portugal.
          </p>
          <p
            className="ob-rise mt-3 max-w-xs text-sm leading-relaxed text-feed-fg/60"
            style={delay(9, 40)}
          >
            Um feed curto, sempre com as notícias mais recentes, feito para o telemóvel.
          </p>
          <button
            type="button"
            onClick={() => setStep("topics")}
            className="ob-rise mt-10 h-14 min-w-44 rounded-full bg-live px-10 text-base font-bold text-live-foreground transition-transform active:scale-[0.97]"
            style={delay(13, 40)}
          >
            Começar
          </button>
        </div>
      ) : null}

      {step === "topics" ? (
        <div key="topics" className="ob-slide relative flex min-h-0 flex-1 flex-col">
          <Header index={0} onSkip={onLater} />
          <Title
            eyebrow="Os teus temas"
            title="Que tipo de notícias gostas de ver?"
            hint="Escolhe um ou mais temas."
          />
          <div className={scrollClass}>
            <div className="grid grid-cols-2 content-start gap-3" role="group" aria-label="Temas">
              {TOPICS.map((topic, index) => {
                const active = picked.includes(topic.category);
                const wide = TOPICS.length % 2 === 1 && index === TOPICS.length - 1;
                return (
                  <button
                    key={topic.category}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleTopic(topic.category)}
                    className={`ob-rise relative flex min-h-[5rem] flex-col items-start justify-between rounded-2xl border p-3 text-left transition-[transform,background-color,border-color] duration-150 active:scale-[0.97] ${
                      wide ? "col-span-2" : ""
                    } ${
                      active
                        ? "border-live bg-live text-live-foreground"
                        : "border-white/10 bg-white/[0.05] text-feed-fg"
                    }`}
                    style={delay(index)}
                  >
                    <span
                      className={`flex size-8 items-center justify-center rounded-full ${active ? "bg-black/15" : "bg-white/10"}`}
                    >
                      {topic.icon}
                    </span>
                    <span className="mt-2 text-base font-semibold">{topic.label}</span>
                    {active ? (
                      <Check className="ob-pop absolute right-3 top-3 size-5" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={footerClass}>
            <p aria-live="polite" className="mb-3 text-center text-xs text-feed-fg/55">
              {picked.length === 0
                ? "Escolhe pelo menos um tema"
                : picked.length === 1
                  ? "1 tema selecionado"
                  : `${picked.length} temas selecionados`}
            </p>
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => setStep("club")}
              className={`h-14 w-full rounded-full text-base font-bold transition-[transform,background-color] active:scale-[0.98] ${
                picked.length ? "bg-live text-live-foreground" : "bg-white/10 text-feed-fg/35"
              }`}
            >
              Continuar
            </button>
          </div>
        </div>
      ) : null}

      {step === "club" ? (
        <div key="club" className="ob-slide relative flex min-h-0 flex-1 flex-col">
          <Header index={1} onBack={() => setStep("topics")} />
          <Title
            eyebrow="O teu clube"
            title="Qual é o teu clube favorito?"
            hint="Primeira Liga 2026/27."
          />
          <div className={scrollClass}>
            <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Clubes">
              {LIGA_CLUBS.map((item, index) => {
                const selected = clubId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => chooseClub(item.id)}
                    className={`ob-rise flex min-h-[6.5rem] flex-col items-center justify-center gap-2 rounded-2xl border px-1.5 py-3 text-center transition-[transform,background-color,border-color] duration-150 active:scale-[0.97] ${
                      selected ? "border-live bg-live/15" : "border-white/10 bg-white/[0.05]"
                    }`}
                    style={delay(index, 30, 12)}
                  >
                    <span className="relative">
                      <span
                        className={`flex size-12 items-center justify-center rounded-full text-sm font-black tracking-wide text-white ${
                          item.color ? "" : "bg-white/10"
                        }`}
                        style={item.color ? { background: item.color } : undefined}
                        aria-hidden
                      >
                        {clubInitials(item.name)}
                      </span>
                      {selected ? (
                        <span className="ob-pop absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-live text-live-foreground">
                          <Check className="size-3.5" strokeWidth={3} aria-hidden />
                        </span>
                      ) : null}
                    </span>
                    <span className="line-clamp-2 text-[12px] font-semibold leading-tight">
                      {item.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className={footerClass}>
            <button
              type="button"
              disabled={!club}
              onClick={() => setStep("done")}
              className={`h-14 w-full rounded-full text-base font-bold transition-[transform,background-color] active:scale-[0.98] ${
                club ? "bg-live text-live-foreground" : "bg-white/10 text-feed-fg/35"
              }`}
            >
              {club ? `Concluir com ${club.name}` : "Escolhe o teu clube"}
            </button>
            <button
              type="button"
              onClick={() => {
                setClubId(null);
                setStep("done");
              }}
              className="mt-1 flex min-h-12 w-full items-center justify-center text-sm font-semibold text-feed-fg/60"
            >
              Continuar sem clube
            </button>
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <div
          role="status"
          className="relative flex flex-1 flex-col items-center justify-center px-8 text-center"
        >
          <span className="ob-pop flex size-20 items-center justify-center rounded-full bg-live text-live-foreground">
            <Check className="size-10" strokeWidth={3} aria-hidden />
          </span>
          <h2
            className="ob-rise mt-6 font-display text-4xl font-black leading-none"
            style={delay(3, 40)}
          >
            Tudo pronto
          </h2>
          {club ? (
            <p className="ob-rise mt-3 text-base text-feed-fg/70" style={delay(6, 40)}>
              {club.name}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
