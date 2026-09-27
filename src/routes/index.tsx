// ============= Full file contents =============
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, Share2, Bookmark, ChevronDown } from "lucide-react";
import heroParlamento from "@/assets/hero-parlamento.jpg";
import desportoEstadio from "@/assets/desporto-estadio.jpg";
import economiaMercado from "@/assets/economia-mercado.jpg";
import mundoCimeira from "@/assets/mundo-cimeira.jpg";
import culturaSintra from "@/assets/cultura-sintra.jpg";
import mundoCalor from "@/assets/mundo-calor.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ao Minuto — Notícias de Portugal em direto" },
      {
        name: "description",
        content:
          "As últimas notícias de Portugal e do mundo, atualizadas ao minuto: política, economia, desporto, cultura e muito mais.",
      },
      { property: "og:title", content: "Ao Minuto — Notícias de Portugal em direto" },
      {
        property: "og:description",
        content:
          "As últimas notícias de Portugal e do mundo, atualizadas ao minuto: política, economia, desporto, cultura e muito mais.",
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
] as const;

type Category = (typeof CATEGORIES)[number];

interface Article {
  id: number;
  category: Exclude<Category, "Tudo">;
  title: string;
  excerpt: string;
  time: string;
  minutesAgo: number;
  author: string;
  likes: number;
  comments: number;
  urgent?: boolean;
  image?: string;
}

const ARTICLES: Article[] = [
  {
    id: 1,
    category: "Política",
    title: "Parlamento aprova novo pacote de habitação com votos contra da oposição",
    excerpt:
      "O diploma foi aprovado com a abstenção do maior partido da oposição e entra em vigor no próximo trimestre. Medidas incluem incentivos ao arrendamento acessível.",
    time: "18:52",
    minutesAgo: 4,
    author: "Marta Sousa",
    urgent: true,
    likes: 842,
    comments: 156,
    image: heroParlamento,
  },
  {
    id: 2,
    category: "Desporto",
    title: "Sporting vence clássico com golo ao minuto 90 e isola-se na liderança",
    excerpt:
      "Estádio de Alvalade ao rubro com o golo da vitória já nos descontos. A equipa da casa soma agora cinco vitórias consecutivas.",
    time: "18:41",
    minutesAgo: 15,
    author: "Rui Almeida",
    likes: 2140,
    comments: 483,
    image: desportoEstadio,
  },
  {
    id: 3,
    category: "Economia",
    title: "PSI-20 fecha em máximos do ano puxado pela banca",
    excerpt:
      "O índice nacional ganhou 1,8% e tocou os 6.204 pontos, numa sessão de otimismo nos mercados europeus.",
    time: "18:20",
    minutesAgo: 36,
    author: "Inês Carvalho",
    likes: 517,
    comments: 89,
    image: economiaMercado,
  },
  {
    id: 4,
    category: "Mundo",
    title: "Cimeira europeia termina com acordo histórico sobre defesa comum",
    excerpt:
      "Os 27 líderes chegaram a consenso após duas noites de negociações. Portugal assegurou financiamento para a indústria naval.",
    time: "17:58",
    minutesAgo: 58,
    author: "João Pereira",
    likes: 963,
    comments: 204,
    image: mundoCimeira,
  },
  {
    id: 5,
    category: "Cultura",
    title: "Festival de Sintra anuncia cabeça de cartaz internacional",
    excerpt:
      "A edição deste ano decorre entre junho e julho e conta com 40 concertos em palcos históricos da vila.",
    time: "17:32",
    minutesAgo: 84,
    author: "Beatriz Nunes",
    likes: 1288,
    comments: 97,
    image: culturaSintra,
  },
  {
    id: 6,
    category: "Economia",
    title: "Inflação abranda para 2,1% em setembro, confirma o INE",
    excerpt:
      "A descida é explicada sobretudo pela queda dos preços da energia. Os bens alimentares mantêm pressão ascendente.",
    time: "17:10",
    minutesAgo: 106,
    author: "Inês Carvalho",
    likes: 342,
    comments: 61,
  },
  {
    id: 7,
    category: "Política",
    title: "Governo anuncia reforço de 500 milhões para o SNS",
    excerpt:
      "O ministro da Saúde apresentou o plano de investimento para 2027, com prioridade para urgências e listas de espera.",
    time: "16:45",
    minutesAgo: 131,
    author: "Marta Sousa",
    likes: 1476,
    comments: 328,
  },
  {
    id: 8,
    category: "Mundo",
    title: "Vaga de calor atinge máximos históricos no sul da Europa",
    excerpt:
      "Vários países mediterrânicos registaram temperaturas acima dos 40 graus. Em Portugal, o Alentejo está sob aviso laranja.",
    time: "16:12",
    minutesAgo: 164,
    author: "João Pereira",
    likes: 729,
    comments: 142,
    image: mundoCalor,
  },
];

const TICKER_ITEMS = [
  "URGENTE · Parlamento aprova pacote de habitação",
  "Sporting 2-1 Benfica · resultado final",
  "PSI-20 +1,8% · 6.204 pontos",
  "Inflação abranda para 2,1%",
  "Aviso laranja no Alentejo até às 21:00",
];

function formatCount(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".", ",") + "k";
  return String(n);
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

function RailButton({
  icon,
  label,
  ariaLabel,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  ariaLabel: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-feed-fg transition-transform active:scale-90"
      aria-label={ariaLabel}
    >
      <span
        className={`flex size-11 items-center justify-center rounded-full backdrop-blur-sm ${
          active ? "animate-heart-pop bg-live text-live-foreground" : "bg-feed-fg/15"
        }`}
      >
        {icon}
      </span>
      <span className="text-[11px] font-semibold tabular-nums drop-shadow">
        {label}
      </span>
    </button>
  );
}

function Index() {
  const now = useClock();
  const [category, setCategory] = useState<Category>("Tudo");
  const [liked, setLiked] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [burst, setBurst] = useState<{ id: number; key: number } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const filtered =
    category === "Tudo"
      ? ARTICLES
      : ARTICLES.filter((a) => a.category === category);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0 });
  }, [category]);

  const toggleLike = (id: number, forceLike = false) => {
    setLiked((prev) => {
      const next = new Set(prev);
      if (next.has(id) && !forceLike) next.delete(id);
      else next.add(id);
      return next;
    });
    if (forceLike || !liked.has(id)) {
      setBurst({ id, key: Date.now() });
    }
  };

  const toggleSave = (id: number) => {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="relative mx-auto h-[100dvh] w-full max-w-xl overflow-hidden bg-feed-bg">
      {/* Feed */}
      <div
        ref={feedRef}
        className="h-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {filtered.map((a, i) => {
          const isLiked = liked.has(a.id);
          return (
            <article
              key={a.id}
              onDoubleClick={() => toggleLike(a.id, true)}
              className="relative h-[100dvh] w-full snap-start snap-always overflow-hidden"
            >
              {/* Background */}
              {a.image ? (
                <img
                  src={a.image}
                  alt={a.title}
                  width={1024}
                  height={1024}
                  loading={i === 0 ? "eager" : "lazy"}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <div
                  className={`absolute inset-0 ${
                    a.id % 2 === 0 ? "feed-grad-a" : "feed-grad-b"
                  }`}
                />
              )}
              <div className="absolute inset-0 feed-scrim" />

              {/* Double-tap heart burst */}
              {burst?.id === a.id && (
                <Heart
                  key={burst.key}
                  className="pointer-events-none absolute left-1/2 top-1/2 z-20 size-28 -translate-x-1/2 -translate-y-1/2 animate-heart-pop fill-live text-live"
                />
              )}

              {/* Urgent badge */}
              {a.urgent && (
                <span className="absolute left-4 top-[104px] z-10 rounded-md bg-live px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-live-foreground">
                  Última hora
                </span>
              )}

              {/* Right action rail */}
              <div className="absolute bottom-28 right-3 z-10 flex flex-col items-center gap-5">
                <RailButton
                  icon={
                    <Heart
                      className={`size-6 ${isLiked ? "animate-heart-pop fill-live-foreground" : ""}`}
                    />
                  }
                  label={formatCount(a.likes + (isLiked ? 1 : 0))}
                  active={isLiked}
                  onClick={() => toggleLike(a.id)}
                />
                <RailButton
                  icon={<MessageCircle className="size-6" />}
                  label={formatCount(a.comments)}
                />
                <RailButton icon={<Share2 className="size-6" />} label="Partilhar" />
                <RailButton
                  icon={
                    <Bookmark
                      className={`size-6 ${saved.has(a.id) ? "fill-feed-fg" : ""}`}
                    />
                  }
                  label={saved.has(a.id) ? "Guardado" : "Guardar"}
                  active={saved.has(a.id)}
                  onClick={() => toggleSave(a.id)}
                />
              </div>

              {/* Bottom story */}
              <div className="absolute inset-x-0 bottom-0 z-10 pr-20 pb-8 pl-4">
                <span className="text-xs font-bold uppercase tracking-widest text-live">
                  {a.category}
                </span>
                <h2 className="mt-1.5 font-display text-2xl font-bold leading-tight text-feed-fg text-balance drop-shadow-md">
                  {a.title}
                </h2>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-feed-fg/85 text-pretty">
                  {a.excerpt}
                </p>
                <p className="mt-2 text-xs font-medium text-feed-fg/70">
                  <span className="font-bold text-live">
                    Há {a.minutesAgo} min
                  </span>{" "}
                  · {a.author} · {a.time}
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
          <div className="mt-2 overflow-hidden rounded-full bg-feed-fg/10 py-1.5 backdrop-blur-sm">
            <div className="flex w-max animate-ticker items-center whitespace-nowrap">
              {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, idx) => (
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
