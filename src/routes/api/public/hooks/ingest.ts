import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/hooks/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        // Mantém a chave do agendador sincronizada (tabela privada, só service_role)
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin
          .from("ingest_state")
          .update({ cron_token: process.env["LOVABLE_CRON_SECRET"] ?? null })
          .eq("id", 1);
        const { runIngest } = await import("@/lib/ingest.server");
        const result = await runIngest();
        return Response.json(result);
      },
    },
  },
});
