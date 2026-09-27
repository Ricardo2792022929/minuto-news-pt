import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import heroParlamento from "@/assets/hero-parlamento.jpg";
import desportoEstadio from "@/assets/desporto-estadio.jpg";

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
  },
];

const TIMELINE = [
  {
    time: "18:52",
    text: "Presidente da República promulga diploma da habitação com reservas.",
    hot: true,
  },
  {
    time: "18:47",
    text: "Oposição anuncia requerimento para audição urgente do ministro.",
    hot: false,
  },
  {
    time: "18:41",
    text: "Sporting vence o clássico 2-1 com golo aos 90 minutos.",
    hot: false,
  },
  {
    time: "18:33",
    text: "IPMA prolonga aviso laranja para o Alentejo até às 21:00.",
    hot: false,
  },
  {
    time: "18:20",
    text: "PSI-20 fecha a sessão em máximos do ano, nos 6.204 pontos.",
    hot: false,
  },
];

const TICKER_ITEMS = [
  "URGENTE · Parlamento aprova pacote de habitação",
  "Sporting 2-1 Benfica · resultado final",
  "PSI-20 +1,8% · 6.204 pontos",
  "Inflação abranda para 2,1%",
  "Aviso laranja no Alentejo até às 21:00",
];

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

function Index() {
  const now = useClock();
  const [category, setCategory] = useState<Category>("Tudo");

  const filtered =
    category === "Tudo"
      ? ARTICLES
      : ARTICLES.filter((a) => a.category === category);
  const hero = filtered[0];
  const rest = filtered.slice(1);

  return (
    <div className="mx-auto min-h-screen w-full max-w-xl bg-background pb-10">
      {/* Masthead */}
      <header className="border-b-2 border-foreground px-4 pb-3 pt-5">
        <div className="flex items-end justify-between">
          <h1 className="font-display text-4xl font-black tracking-tight">
            Ao<span className="text-live">Minuto</span>
          </h1>
          <div className="flex items-center gap-2 pb-1">
            <span className="relative flex size-2">
              <span className="absolute inset-0 animate-live-pulse rounded-full bg-live" />
              <span className="relative size-2 rounded-full bg-live" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Em direto · {formatClock(now)}
            </span>
          </div>
        </div>
        <p className="mt-1 text-xs capitalize text-muted-foreground">
          {formatDate(now)} · Lisboa
        </p>
      </header>

      {/* Breaking ticker */}
      <div className="overflow-hidden border-b border-border bg-foreground py-2">
        <div className="flex w-max animate-ticker items-center whitespace-nowrap">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span
              key={i}
              className="px-4 text-xs font-semibold uppercase tracking-wide text-background"
            >
              {item}
              <span className="pl-4 text-live">●</span>
            </span>
          ))}
        </div>
      </div>

      {/* Category filter */}
      <nav className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              category === c
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-border"
            }`}
          >
            {c}
          </button>
        ))}
      </nav>

      {/* Hero article */}
      {hero && (
        <article key={hero.id} className="animate-rise px-4">
          {hero.image && (
            <div className="relative overflow-hidden rounded-xl">
              <img
                src={hero.image}
                alt={hero.title}
                width={1088}
                height={720}
                className="aspect-[16/10] w-full object-cover"
              />
              {hero.urgent && (
                <span className="absolute left-3 top-3 rounded-md bg-live px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-live-foreground">
                  Última hora
                </span>
              )}
            </div>
          )}
          <div className="mt-3">
            <span className="text-xs font-bold uppercase tracking-widest text-live">
              {hero.category}
            </span>
            <h2 className="mt-1 font-display text-2xl font-bold leading-tight text-balance">
              {hero.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
              {hero.excerpt}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-semibold text-live">
                Há {hero.minutesAgo} min
              </span>{" "}
              · Por {hero.author}
            </p>
          </div>
        </article>
      )}

      {/* Minuto a minuto timeline */}
      <section className="mt-8 px-4">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
          <span className="size-2 rounded-full bg-live" />
          Minuto a minuto
        </h3>
        <div className="relative ml-1 mt-4 border-l-2 border-border pl-5">
          {TIMELINE.map((entry, i) => (
            <div key={entry.time} className="relative mb-5 last:mb-0">
              <span
                className={`absolute -left-[27px] top-1 size-3 rounded-full ring-4 ring-background ${
                  entry.hot ? "bg-live" : "bg-muted-foreground/50"
                }`}
              />
              <p
                className={`text-[11px] font-bold tabular-nums ${
                  entry.hot ? "text-live" : "text-muted-foreground"
                }`}
              >
                {entry.time}
                {entry.hot && (
                  <span className="ml-2 rounded-sm bg-live px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-live-foreground">
                    Agora
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-sm font-medium leading-snug text-pretty">
                {entry.text}
              </p>
              {i === TIMELINE.length - 1 && null}
            </div>
          ))}
        </div>
      </section>

      {/* Article list */}
      <section className="mt-8 px-4">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Mais notícias
        </h3>
        <div className="mt-3 divide-y divide-border">
          {rest.map((a) => (
            <article key={a.id} className="flex gap-3 py-4">
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-bold uppercase tracking-widest text-live">
                  {a.category}
                </span>
                <h4 className="mt-1 font-display text-lg font-bold leading-snug text-balance">
                  {a.title}
                </h4>
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {a.excerpt}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Há {a.minutesAgo} min · {a.author}
                </p>
              </div>
              {a.image && (
                <img
                  src={a.image}
                  alt={a.title}
                  width={816}
                  height={816}
                  loading="lazy"
                  className="size-20 shrink-0 rounded-lg object-cover"
                />
              )}
            </article>
          ))}
        </div>
      </section>

      <footer className="mt-10 border-t border-border px-4 pt-4 text-center text-xs text-muted-foreground">
        AoMinuto · Notícias de demonstração · {now.getFullYear()}
      </footer>
    </div>
  );
}
