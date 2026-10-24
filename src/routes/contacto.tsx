import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Mail, Globe, Phone } from "lucide-react";

export const Route = createFileRoute("/contacto")({
  head: () => ({
    meta: [
      { title: "Contact us — Flash Notícias" },
      {
        name: "description",
        content: "Contacto do desenvolvedor da Flash Notícias Portugal.",
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <main className="min-h-screen bg-[#0c0a09] px-5 py-8 text-white">
      <div className="mx-auto max-w-lg">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-white/80"
        >
          <ArrowLeft className="size-4" />
          Voltar ao feed
        </Link>

        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-red-500">
          Flash Notícias Portugal
        </p>
        <h1 className="mt-2 font-display text-4xl font-black tracking-tight">
          Contact us
        </h1>
        <p className="mt-3 text-base leading-relaxed text-white/75">
          A Flash Notícias é um agregador de notícias. Para questões sobre a
          app, o conteúdo ou o desenvolvedor, usa os dados abaixo.
        </p>

        <section className="mt-8 rounded-2xl border border-yellow-400/40 bg-yellow-400/10 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-yellow-300">
            Contact
          </h2>
          <a
            href="tel:+351913943621"
            className="mt-4 flex items-center gap-3 text-2xl font-black text-white"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-yellow-400 text-black">
              <Phone className="size-5" />
            </span>
            +351 913 943 621
          </a>
          <a
            href="mailto:apoio.flashnoticias@gmail.com"
            className="mt-4 flex items-center gap-3 text-lg font-semibold text-white"
          >
            <Mail className="size-5 text-yellow-400" />
            apoio.flashnoticias@gmail.com
          </a>
          <a
            href="https://minuto-news-pt.lovable.app"
            className="mt-3 flex items-center gap-3 text-base text-white/80"
          >
            <Globe className="size-5 text-yellow-400" />
            minuto-news-pt.lovable.app
          </a>
        </section>

        <p className="mt-6 text-sm leading-relaxed text-white/55">
          As notícias vêm de fontes públicas portuguesas. O contacto acima é do
          desenvolvedor da app, não das fontes originais.
        </p>
      </div>
    </main>
  );
}
