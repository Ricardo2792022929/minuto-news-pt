import { createFileRoute } from "@tanstack/react-router";

type LooseSelect = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: number) => {
        maybeSingle: () => PromiseLike<{ data: { refresh_token_hash?: string | null } | null; error: { message: string } | null }>;
      };
    };
  };
};

/**
 * Só os agendadores (GitHub Actions com o secret REFRESH_TOKEN e o pg_cron do Supabase com o token no Vault) podem chamar este endereço: cada chamada gasta
 * quota das IAs de título e das APIs de imagens. A base guarda apenas o SHA-256 do token
 * (ingest_state.refresh_token_hash, um ou mais separados por vírgula), nunca o token. Sem hash configurado, recusa (falha fechada).
 */
async function authorize(request: Request): Promise<Response | null> {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1];
  if (!token) return new Response("Unauthorized", { status: 401 });

  const { createHash, timingSafeEqual } = await import("node:crypto");
  const encoder = new TextEncoder();
  const provided = encoder.encode(createHash("sha256").update(token, "utf8").digest("hex"));

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as unknown as LooseSelect)
    .from("ingest_state")
    .select("refresh_token_hash")
    .eq("id", 1)
    .maybeSingle();
  // Pode haver mais de um token válido (separados por vírgula): um do GitHub Actions e um do pg_cron do Supabase.
  const storedHashes = (data?.refresh_token_hash ?? "")
    .split(/[\s,]+/)
    .filter((hex) => /^[0-9a-f]{64}$/i.test(hex))
    .map((hex) => hex.toLowerCase());
  if (error || storedHashes.length === 0) {
    console.error("refresh_auth_unconfigured", error?.message ?? "sem refresh_token_hash");
    return new Response("Server configuration error", { status: 503 });
  }
  let ok = false;
  for (const hex of storedHashes) if (timingSafeEqual(provided, encoder.encode(hex))) ok = true;
  return ok ? null : new Response("Unauthorized", { status: 401 });
}

async function refresh({ request }: { request: Request }) {
  const denied = await authorize(request);
  if (denied) return denied;
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
