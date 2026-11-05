import { createFileRoute } from "@tanstack/react-router";

async function refresh({ request }: { request: Request }) {
  if (new URL(request.url).searchParams.get("probe") === "1") {
    const { probeTitleApis } = await import("@/lib/api-probe.server");
    return Response.json(await probeTitleApis());
  }
  const { runIngest } = await import("@/lib/ingest.server");
  const asked = Number(new URL(request.url).searchParams.get("budget"));
  const result = await runIngest(asked > 0 ? { budgetMs: asked * 1000 } : {});
  // Reescreve aqui (agendado) os títulos que ficaram iguais ao original, em vez de no pedido do feed.
  // Limitado a 12 s para a chamada caber no --max-time 90 do workflow.
  let rewritten: number | "timeout" | "error" = 0;
  try {
    const { rewriteOpenedTitles } = await import("@/lib/rewrite-open.server");
    rewritten = await Promise.race([
      rewriteOpenedTitles(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 12_000)),
    ]);
  } catch (error) {
    console.error("resumo", error instanceof Error ? error.message : error);
    rewritten = "error";
  }
  return Response.json({ ...result, rewritten });
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
