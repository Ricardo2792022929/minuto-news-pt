import { createFileRoute } from "@tanstack/react-router";

async function refresh() {
  const { runIngest } = await import("@/lib/ingest.server");
  const result = await runIngest();
  return Response.json(result);
}

// Endereço fixo para o agendador. Não depende do trabalho do Lovable.
export const Route = createFileRoute("/api/public/hooks/refresh")({
  server: {
    handlers: {
      GET: refresh,
      POST: refresh,
    },
  },
});
