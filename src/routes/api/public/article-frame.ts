import { createFileRoute } from "@tanstack/react-router";

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

function canEmbed(headers: Headers): boolean {
  const frame = (headers.get("x-frame-options") ?? "").toLowerCase();
  if (frame.includes("deny") || frame.includes("sameorigin")) return false;
  const csp = (headers.get("content-security-policy") ?? "").toLowerCase();
  const ancestors = csp.match(/frame-ancestors\s+([^;]+)/)?.[1] ?? "";
  if (!ancestors) return true;
  if (ancestors.includes("'none'") || ancestors.includes("'self'")) return false;
  return ancestors.includes("*");
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
          return Response.json({ embed: false });
        }
        if (!allowed(page)) return Response.json({ embed: false });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
          let res = await fetch(page, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
          if (res.status === 405 || res.status === 501) {
            res = await fetch(page, { method: "GET", redirect: "follow", signal: ctrl.signal });
          }
          await res.body?.cancel();
          const finalUrl = new URL(res.url);
          return Response.json({ embed: allowed(finalUrl) && canEmbed(res.headers) });
        } catch {
          return Response.json({ embed: false });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
