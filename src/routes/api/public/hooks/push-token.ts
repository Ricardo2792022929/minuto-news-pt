import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/push-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let token = "";
        try {
          const body = (await request.json()) as { token?: unknown };
          if (typeof body.token === "string") token = body.token.trim();
        } catch {
          return Response.json({ ok: false }, { status: 400 });
        }
        if (token.length < 20 || token.length > 4096) return Response.json({ ok: false }, { status: 400 });
        const { subscribeToken } = await import("@/lib/push.server");
        const result = await subscribeToken(token);
        return Response.json({ ok: result === "ok" });
      },
    },
  },
});
