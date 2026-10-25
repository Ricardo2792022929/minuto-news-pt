import { createFileRoute } from "@tanstack/react-router";

const MAX_CHARS = 1_200_000;

function allowed(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "metadata.google.internal") return false;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return true;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  return true;
}

function frameHtml(raw: string, page: string): string {
  const withBase = /<head[^>]*>/i.test(raw)
    ? raw.replace(/<head[^>]*>/i, (head) => `${head}<base href="${page}">`)
    : `<!doctype html><html><head><base href="${page}"></head><body>${raw}</body></html>`;
  return withBase.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+=(?:"[^"]*"|'[^']*')/gi, "");
}

export const Route = createFileRoute("/api/public/article-frame")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = new URL(request.url).searchParams.get("url") ?? "";
        let page: URL;
        try {
          page = new URL(target);
        } catch {
          return new Response("Endereço inválido", { status: 400 });
        }
        if (!allowed(page)) return new Response("Endereço bloqueado", { status: 400 });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(page, {
            signal: ctrl.signal,
            redirect: "follow",
            headers: {
              "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
              accept: "text/html",
              "accept-language": "pt-PT,pt;q=0.9",
            },
          });
          if (!res.ok) return new Response("Não foi possível abrir a notícia", { status: 502 });
          const finalUrl = new URL(res.url);
          if (!allowed(finalUrl)) return new Response("Endereço bloqueado", { status: 400 });
          const html = (await res.text()).slice(0, MAX_CHARS);
          return new Response(frameHtml(html, finalUrl.toString()), {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https: data:; img-src https: data: blob:; font-src https: data:; media-src https:;",
              "cache-control": "private, max-age=120",
            },
          });
        } catch {
          return new Response("Não foi possível abrir a notícia", { status: 502 });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
