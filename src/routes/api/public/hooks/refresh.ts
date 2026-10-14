import { createFileRoute } from "@tanstack/react-router";

async function refresh({ request }: { request: Request }) {
  if (new URL(request.url).searchParams.get("probe") === "1") {
    const { probeTitleApis } = await import("@/lib/api-probe.server");
    return Response.json(await probeTitleApis());
  }
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
