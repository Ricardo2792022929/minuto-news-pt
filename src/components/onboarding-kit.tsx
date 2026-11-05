import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  ArrowLeft,
  Cpu,
  Globe,
  Landmark,
  Palette,
  Sparkles,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { clubInitials, type LigaClub } from "@/lib/clubs";

/* Peças partilhadas da primeira utilização: palco em cima, folha (bottom sheet) em baixo.
   Só transform e opacidade, sem desfoques, para correr bem em Android de gama baixa. */

export type Topic = { category: string; hue: number; Icon: LucideIcon };

export const TOPICS: Topic[] = [
  { category: "Política", hue: 255, Icon: Landmark },
  { category: "Economia", hue: 160, Icon: TrendingUp },
  { category: "Desporto", hue: 45, Icon: Trophy },
  { category: "Mundo", hue: 205, Icon: Globe },
  { category: "Cultura", hue: 305, Icon: Palette },
  { category: "Entretenimento", hue: 350, Icon: Sparkles },
  { category: "Tech", hue: 230, Icon: Cpu },
];

export function tick() {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* sem vibração neste dispositivo */
  }
}

/* ---------- Estrutura ---------- */

export function FlowShell({
  top,
  stage,
  sheet,
  tall = false,
}: {
  top: ReactNode;
  stage: ReactNode;
  sheet: ReactNode;
  /** Folha mais alta para listas longas; o palco encolhe sozinho. */
  tall?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-black text-feed-fg [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-2/3"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 32%, color-mix(in oklab, var(--live) 24%, transparent), transparent 75%)",
        }}
      />
      {top}
      {stage}
      <section
        className={`relative z-10 flex ${tall ? "h-[74dvh] max-h-[48rem]" : "h-[60dvh] max-h-[42rem]"} transition-[height] duration-300 ease-out motion-reduce:transition-none min-h-[22rem] flex-none flex-col rounded-t-[28px] bg-ob-s1 shadow-[0_-1px_0_rgba(255,255,255,0.07)]`}
      >
        {sheet}
      </section>
    </div>
  );
}

export function TopBar({
  total,
  index,
  onBack,
  action,
}: {
  total: number;
  index: number;
  onBack?: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="relative z-10 px-2 pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar"
            className={`flex size-12 items-center justify-center rounded-full text-feed-fg ob-press ob-focus`}
          >
            <ArrowLeft className="size-6" />
          </button>
        ) : (
          <span className="size-12" aria-hidden />
        )}
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className={`flex h-12 items-center rounded-full px-4 text-[15px] font-semibold text-ob-fg2 ob-press ob-focus`}
          >
            {action.label}
          </button>
        ) : (
          <span className="size-12" aria-hidden />
        )}
      </div>
      {total > 1 ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+1.75rem)] flex -translate-y-1/2 justify-center gap-1.5"
          role="progressbar"
          aria-label={`Passo ${index + 1} de ${total}`}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
        >
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${
                i === index ? "w-5 bg-live" : "w-1.5 bg-white/25"
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Caixa de tamanho fixo que encolhe para caber no espaço que sobra por cima da folha. */
export function Stage({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      setScale(Math.max(0, Math.min(1, (box.height - 8) / height, (box.width - 16) / width)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height]);

  return (
    <div ref={ref} className="relative min-h-0 flex-1" aria-hidden>
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width,
          height,
          transform: `translate(-50%, -50%) scale(${scale})`,
          visibility: scale < 0.5 ? "hidden" : "visible",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------- Folha ---------- */

export function SheetHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <header className="px-6 pt-7">
      <h1 className="font-display text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.01em] text-balance">
        {title}
      </h1>
      <p aria-live="polite" className="mt-2 max-w-[34ch] text-[15px] leading-[1.45] text-ob-fg2">
        {hint}
      </p>
    </header>
  );
}

export function SheetScroll({ children }: { children: ReactNode }) {
  return (
    <div className="ob-fade-b min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-7 pt-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function SheetActions({ children }: { children: ReactNode }) {
  return (
    <footer className="flex flex-none flex-col gap-1 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
      {children}
    </footer>
  );
}

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-14 w-full items-center justify-center rounded-full bg-live text-base font-semibold text-live-foreground transition-[transform,background-color,color] disabled:bg-white/10 disabled:text-ob-fg3 ob-focus`}
    />
  );
}

export function TextButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold text-ob-fg2 ob-press disabled:opacity-50 ob-focus`}
    />
  );
}

/* ---------- Palco: o feed a construir-se ---------- */

const SLOTS = [
  { x: 0, y: 8, r: 0, s: 1, z: 3 },
  { x: -80, y: 24, r: -8, s: 0.94, z: 2 },
  { x: 80, y: 28, r: 8, s: 0.94, z: 1 },
];

function cardBackground(hue: number): string {
  return `linear-gradient(165deg, oklch(0.5 0.13 ${hue}), oklch(0.2 0.05 ${hue}))`;
}

export const FAN_SIZE = { width: 300, height: 250 };

/** Até três cartões do feed. O mais recente fica à frente; os que não foram escolhidos ficam mais discretos. */
export function FeedFan({
  topics,
  chosen,
  extra,
  club,
}: {
  topics: Topic[];
  chosen: ReadonlySet<string>;
  extra: number;
  club: LigaClub | null;
}) {
  const dim = chosen.size > 0;
  return (
    <div className="relative size-full">
      {topics.slice(0, 3).map((topic, index) => {
        const slot = SLOTS[index] ?? { x: 0, y: 0, r: 0, s: 1, z: 1 };
        const faded = dim && !chosen.has(topic.category);
        return (
          <div
            key={topic.category}
            className="ob-slot absolute left-1/2 top-0 h-[220px] w-[124px] -ml-[62px]"
            style={{
              zIndex: slot.z,
              opacity: faded ? 0.55 : 1,
              transform: `translate3d(${slot.x}px, ${slot.y}px, 0) rotate(${slot.r}deg) scale(${slot.s})`,
            }}
          >
            <div
              className="ob-lift relative size-full overflow-hidden rounded-[18px] shadow-[0_18px_28px_-10px_rgba(0,0,0,0.7)]"
              style={{ background: cardBackground(topic.hue), animationDelay: `${index * 90}ms` }}
            >
              <topic.Icon
                className="absolute left-1/2 top-[38%] size-14 -translate-x-1/2 -translate-y-1/2 text-white/25"
                strokeWidth={1.5}
              />
              {index === 0 && extra > 0 ? (
                <span className="ob-pop absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">
                  +{extra}
                </span>
              ) : null}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-10">
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 rounded-full bg-live px-2 py-0.5 text-[10px] font-extrabold text-live-foreground">
                    {index === 0 ? (
                      <span className="animate-live-pulse size-1.5 rounded-full bg-live-foreground" />
                    ) : null}
                    Agora
                  </span>
                  {index === 0 ? (
                    <span className="truncate text-[10px] font-semibold text-white/80">
                      {topic.category}
                    </span>
                  ) : null}
                </div>
                <span className="mt-2 block h-1.5 w-[88%] rounded-full bg-white/80" />
                <span className="mt-1.5 block h-1.5 w-[62%] rounded-full bg-white/45" />
              </div>
            </div>
          </div>
        );
      })}
      {club ? (
        <span
          key={club.id}
          className="ob-pop absolute left-[78px] top-[196px] z-10 flex size-11 items-center justify-center rounded-full text-[13px] font-extrabold text-white ring-[3px] ring-black"
          style={{ background: club.color ?? "oklch(0.4 0.03 60)" }}
        >
          {clubInitials(club.name)}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- Palco: aviso no telemóvel ---------- */

export const NOTIFICATION_SIZE = { width: 330, height: 150 };

export function NotificationMock() {
  return (
    <div className="relative size-full">
      <div
        className="absolute inset-x-6 top-[14px] h-[120px] rounded-[24px] bg-ob-s2 opacity-50"
        style={{ transform: "scale(0.96)" }}
      />
      <div className="ob-drop absolute inset-x-0 top-0 rounded-[24px] bg-ob-s2 p-3.5 shadow-[0_18px_30px_-12px_rgba(0,0,0,0.7)]">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-live">
            <Zap className="size-3 text-live-foreground" strokeWidth={2.5} />
          </span>
          <span className="text-xs font-medium text-ob-fg2">Flash Notícias • agora</span>
        </div>
        <div className="mt-2.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-5">Última hora</p>
            <p className="mt-0.5 text-sm leading-5 text-ob-fg2">
              Aqui chega o aviso, mesmo com a app fechada.
            </p>
          </div>
          <span
            className="flex size-14 flex-none items-center justify-center rounded-xl"
            style={{ background: cardBackground(205) }}
          >
            <Globe className="size-6 text-white/45" strokeWidth={1.5} />
          </span>
        </div>
      </div>
    </div>
  );
}
