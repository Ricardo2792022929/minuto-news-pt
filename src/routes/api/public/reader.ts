import { createFileRoute } from "@tanstack/react-router";

const AGENT =
  "Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

function allowed(page: URL) {
  const host = page.hostname.toLowerCase();
  return page.protocol === "https:" && (host === "iol.pt" || host.endsWith(".iol.pt"));
}

function proxyHref(href: string, page: URL, origin: string) {
  try {
    const next = new URL(href, page);
    if (!allowed(next)) return next.href;
    return `${origin}/api/public/reader?u=${encodeURIComponent(next.href)}`;
  } catch {
    return href;
  }
}

function readablePage(html: string, page: URL, origin: string) {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe\b[^>]*\/?>/gi, "");
  const linked = withoutScripts.replace(/<a\b[^>]*>/gi, (tag) =>
    tag
      .replace(/\s+target=(["']).*?\1/gi, "")
      .replace(/\shref=(["'])(.*?)\1/i, (_match, quote: string, href: string) => {
        if (!href || href.startsWith("#") || /^(mailto|javascript|tel):/i.test(href)) {
          return ` href=${quote}${href}${quote}`;
        }
        return ` href=${quote}${proxyHref(href, page, origin)}${quote}`;
      }),
  );
  const style = `<base href="${page.href.replace(/"/g, "%22")}"><style>
    .iol-comercial-placement,#inter,#popin,#anchor,#L_BAND,#outdated-browser,.pub-outer-wrapper,#ebx{display:none!important}
    html,body,#contentwrapper{opacity:1!important;visibility:visible!important;background:#fff;color:#111}
    #contentwrapper{display:block!important;margin-top:0!important}
  </style>`;
  if (/<head[^>]*>/i.test(linked)) return linked.replace(/<head[^>]*>/i, (head) => `${head}${style}`);
  return `<!DOCTYPE html><html><head>${style}</head><body>${linked}</body></html>`;
}

export const Route = createFileRoute("/api/public/reader")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = new URL(request.url).searchParams.get("u") ?? "";
        let page: URL;
        try {
          page = new URL(target);
        } catch {
          return new Response("Endereço inválido", { status: 400 });
        }
        if (!allowed(page)) return new Response("Site não suportado", { status: 400 });
        const upstream = await fetch(page.href, {
          redirect: "follow",
          headers: {
            "User-Agent": AGENT,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "pt-PT,pt;q=0.9",
          },
        });
        let finalPage: URL;
        try {
          finalPage = new URL(upstream.url);
        } catch {
          finalPage = page;
        }
        if (!allowed(finalPage)) return new Response("Site não suportado", { status: 400 });
        if (!upstream.ok) return new Response("Não foi possível abrir a notícia", { status: 502 });
        const type = upstream.headers.get("content-type") ?? "";
        if (!/text\/html|application\/xhtml/i.test(type)) {
          return new Response(await upstream.arrayBuffer(), {
            headers: {
              "content-type": type || "application/octet-stream",
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
        }
        const html = await upstream.text();
        if (html.length > 2_000_000) return new Response("Página demasiado grande", { status: 502 });
        return new Response(readablePage(html, finalPage, new URL(request.url).origin), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy":
              "default-src 'none'; img-src https: data:; style-src https: 'unsafe-inline'; font-src https: data:; media-src https:; frame-src 'none'; script-src 'none'; connect-src 'none'; base-uri https:",
          },
        });
      },
    },
  },
});
