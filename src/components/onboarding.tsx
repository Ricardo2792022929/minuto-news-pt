import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUp, Zap } from "lucide-react";
import { LIGA_CLUBS, clubInitials } from "@/lib/clubs";
import {
  FAN_SIZE,
  FeedFan,
  FlowShell,
  NOTIFICATION_SIZE,
  NotificationMock,
  PrimaryButton,
  SheetActions,
  SheetHeader,
  SheetScroll,
  Stage,
  TOPICS,
  TextButton,
  TopBar,
  tick,
} from "./onboarding-kit";
import { PushSheet } from "./push-ask";

type Step = "welcome" | "topics" | "club" | "push" | "done";

export type PushHooks = {
  /** Pede a autorização e regista o telemóvel. Devolve se ficou ativo. */
  enable: () => Promise<boolean>;
  decline: () => void;
};

/** Cartões que aparecem antes de escolheres qualquer tema. */
const DEFAULT_CARDS = ["Mundo", "Desporto", "Economia"];

/** Confirmação final curta antes de entregar as escolhas à app. */
const DONE_MS = 900;

/** No Android a intro nativa passa por cima da app; as boas-vindas esperam só um pouco depois de a página montar. */
const NATIVE_WAIT_MS = 1200;
/** Nunca esperar para lá do fim da intro (~3 s desde o arranque da página). */
const NATIVE_INTRO_END_MS = 3250;

function inNativeShell(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return (
      new URLSearchParams(window.location.search).has("nativeIntro") ||
      Boolean(cap?.isNativePlatform?.()) ||
      /\bwv\b/.test(navigator.userAgent || "")
    );
  } catch {
    return false;
  }
}

/** Devolve true quando a intro nativa já acabou (de imediato fora da app Android). */
function useAfterNativeIntro(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!inNativeShell()) {
      setReady(true);
      return;
    }
    // performance.now() conta desde o arranque da página.
    const wait = Math.min(NATIVE_WAIT_MS, Math.max(0, NATIVE_INTRO_END_MS - performance.now()));
    const id = window.setTimeout(() => setReady(true), wait);
    return () => window.clearTimeout(id);
  }, []);
  return ready;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 20) return "Boa tarde";
  return "Boa noite";
}

function hintFor(count: number): string {
  if (count === 0) return "Escolhe pelo menos um tema.";
  return count === 1 ? "1 tema escolhido." : `${count} temas escolhidos.`;
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex size-10 flex-none items-center justify-center rounded-full bg-ob-s2">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-5">{title}</span>
        <span className="mt-0.5 block text-sm leading-5 text-ob-fg2">{text}</span>
      </span>
    </li>
  );
}

export function Onboarding({
  onDone,
  onLater,
  push,
}: {
  onDone: (interests: string[], club: string | null) => void;
  onLater: () => void;
  push?: PushHooks | null;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hello] = useState(greeting);
  const [picked, setPicked] = useState<string[]>([]);
  const [clubId, setClubId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const introOver = useAfterNativeIntro();

  // O pai recria as funções a cada render e o aviso só fica a saber-se a meio do fluxo.
  const latest = useRef({ onDone, picked, clubId, push });
  latest.current = { onDone, picked, clubId, push };
  const finished = useRef(false);

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

  const go = (next: Step, dir: 1 | -1 = 1) => {
    setDirection(dir);
    setStep(next);
  };

  const toggleTopic = (category: string) => {
    tick();
    setPicked((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category],
    );
  };

  const chooseClub = (id: string) => {
    tick();
    setClubId(id);
  };

  const afterClub = () => go(latest.current.push ? "push" : "done");

  const enablePush = async () => {
    const hooks = latest.current.push;
    if (busy || !hooks) return;
    setBusy(true);
    try {
      await hooks.enable();
    } catch {
      /* sem autorização: segue na mesma */
    }
    setBusy(false);
    go("done");
  };

  const skipPush = () => {
    latest.current.push?.decline();
    go("done");
  };

  const club = LIGA_CLUBS.find((item) => item.id === clubId) ?? null;
  const chosen = new Set(picked);
  const newestFirst = [...picked].reverse();
  const fanCategories = [
    ...newestFirst,
    ...DEFAULT_CARDS.filter((category) => !chosen.has(category)),
  ].slice(0, 3);
  const fanTopics = fanCategories
    .map((category) => TOPICS.find((topic) => topic.category === category))
    .filter((topic): topic is (typeof TOPICS)[number] => Boolean(topic));

  const order: Step[] = ["welcome", "topics", "club", ...(push ? (["push"] as const) : [])];
  const index = Math.max(0, order.indexOf(step === "done" ? order[order.length - 1] : step));

  const back =
    step === "topics"
      ? () => go("welcome", -1)
      : step === "club"
        ? () => go("topics", -1)
        : step === "push"
          ? () => go("club", -1)
          : undefined;

  const swap = direction > 0 ? "ob-slide" : "ob-slide-back";

  // Enquanto a intro nativa corre, só um fundo preto: as animações começam quando o fluxo monta.
  if (!introOver) return <div aria-hidden className="fixed inset-0 z-[100] h-[100dvh] bg-black" />;

  return (
    <FlowShell
      tall={step === "club"}
      top={
        <TopBar
          total={order.length}
          index={index}
          onBack={back}
          action={step === "topics" ? { label: "Saltar", onClick: onLater } : undefined}
        />
      }
      stage={
        step === "push" ? (
          <Stage key="notification" {...NOTIFICATION_SIZE}>
            <NotificationMock />
          </Stage>
        ) : (
          <Stage key="fan" {...FAN_SIZE}>
            <FeedFan
              topics={fanTopics}
              chosen={chosen}
              extra={Math.max(0, picked.length - 3)}
              club={club}
            />
          </Stage>
        )
      }
      sheet={
        <div key={step} className={`${swap} flex min-h-0 flex-1 flex-col`}>
          {step === "welcome" ? (
            <>
              <SheetHeader
                title={`${hello}.`}
                hint="Um feed curto, sempre com as notícias mais recentes de Portugal e do mundo."
              />
              <SheetScroll>
                <ul className="space-y-5 px-6">
                  <Feature
                    icon={<Zap className="size-5" />}
                    title="Sempre as mais recentes"
                    text="O feed atualiza ao minuto, com a hora em cada notícia."
                  />
                  <Feature
                    icon={<ChevronsUp className="size-5" />}
                    title="Uma notícia por ecrã"
                    text="Desliza para cima para a seguinte e para o lado para mudar de secção."
                  />
                </ul>
              </SheetScroll>
              <SheetActions>
                <PrimaryButton onClick={() => go("topics")}>Começar</PrimaryButton>
              </SheetActions>
            </>
          ) : null}

          {step === "topics" ? (
            <>
              <SheetHeader title="O que queres acompanhar?" hint={hintFor(picked.length)} />
              <SheetScroll>
                <div className="flex flex-wrap gap-2.5 px-6" role="group" aria-label="Temas">
                  {TOPICS.map((topic) => {
                    const active = chosen.has(topic.category);
                    return (
                      <button
                        key={topic.category}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleTopic(topic.category)}
                        className={`flex h-12 items-center gap-2.5 rounded-2xl pl-2 pr-4 text-[15px] font-medium transition-[background-color,transform] duration-150 ob-focus ${
                          active ? "bg-ob-tonal text-ob-on-tonal" : "bg-ob-s2 text-feed-fg"
                        }`}
                      >
                        <span
                          className="flex size-8 items-center justify-center rounded-full"
                          style={{ background: `oklch(${active ? 0.82 : 0.46} 0.13 ${topic.hue})` }}
                        >
                          {active ? (
                            <Check className="ob-pop size-4 text-black/80" strokeWidth={3} />
                          ) : (
                            <topic.Icon className="size-4 text-white" />
                          )}
                        </span>
                        {topic.category}
                      </button>
                    );
                  })}
                </div>
              </SheetScroll>
              <SheetActions>
                <PrimaryButton disabled={picked.length === 0} onClick={() => go("club")}>
                  Continuar
                </PrimaryButton>
              </SheetActions>
            </>
          ) : null}

          {step === "club" ? (
            <>
              <SheetHeader
                title="Qual é o teu clube?"
                hint="Vamos incluir no teu feed as notícias do teu clube."
              />
              <SheetScroll>
                <div role="radiogroup" aria-label="Clubes" className="flex flex-col">
                  {LIGA_CLUBS.map((item, rowIndex) => {
                    const selected = clubId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => chooseClub(item.id)}
                        className={`flex h-16 w-full items-center gap-4 px-6 text-left transition-colors duration-150 ob-press ob-focus ${
                          rowIndex > 0 ? "ob-divider" : ""
                        } ${selected ? "bg-ob-tonal" : ""}`}
                      >
                        <span
                          aria-hidden
                          className="flex size-10 flex-none items-center justify-center rounded-full text-[13px] font-bold text-white"
                          style={{ background: item.color ?? "oklch(0.36 0.02 60)" }}
                        >
                          {clubInitials(item.name)}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-base font-medium ${
                            selected ? "text-ob-on-tonal" : ""
                          }`}
                        >
                          {item.name}
                        </span>
                        <span
                          aria-hidden
                          className={`flex size-6 flex-none items-center justify-center rounded-full border-2 ${
                            selected ? "border-ob-on-tonal" : "border-white/30"
                          }`}
                        >
                          {selected ? (
                            <span className="ob-pop size-3 rounded-full bg-ob-on-tonal" />
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </SheetScroll>
              <SheetActions>
                <PrimaryButton disabled={!club} onClick={afterClub}>
                  Continuar
                </PrimaryButton>
                <TextButton
                  onClick={() => {
                    setClubId(null);
                    afterClub();
                  }}
                >
                  Continuar sem clube
                </TextButton>
              </SheetActions>
            </>
          ) : null}

          {step === "push" ? (
            <PushSheet busy={busy} onYes={() => void enablePush()} onNo={skipPush} />
          ) : null}

          {step === "done" ? (
            <div
              role="status"
              className="flex flex-1 flex-col items-center justify-center px-8 pb-10 text-center"
            >
              <span className="ob-pop flex size-16 items-center justify-center rounded-full bg-live">
                <Check className="size-8 text-live-foreground" strokeWidth={3} aria-hidden />
              </span>
              <h1 className="mt-5 font-display text-[1.75rem] font-extrabold leading-tight">
                Tudo pronto
              </h1>
              <p className="mt-1 text-[15px] text-ob-fg2">A preparar o teu feed.</p>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
