import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const cache = new Map<string, { bullets: string[]; at: number }>();
const TTL = 60 * 60_000;

const SYSTEM = `Transforma o texto fornecido das notícias detalhadas num resumo sintético em bullet points para uma app de notícias.

REGRAS:
1. NUNCA devolvas o texto integral nem faças paráfrases longas.
2. Extrai exatamente 3 pontos-chave factuais (bullet points) em português de Portugal.
3. Cada ponto deve ter no máximo 15 palavras.
4. Baseia-te ESTRITAMENTE no texto fornecido. Não adiciones factos externos nem opiniões.
5. NUNCA comentes a quantidade ou a falta de texto. Mesmo com pouco texto, devolve exatamente 3 pontos factuais sobre o assunto da notícia.

FORMATO DE SAÍDA:
• [Facto principal 1]
• [Facto principal 2]
• [Facto principal 3]`;

export const summarizeArticle = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ id: z.string(), text: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }): Promise<{ bullets: string[] }> => {
    const hit = cache.get(data.id);
    if (hit && Date.now() - hit.at < TTL) return { bullets: hit.bullets };

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { bullets: [] };

    try {
      const res = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: data.text.slice(0, 8000) },
            ],
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!res.ok) return { bullets: [] };
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      const bullets = content
        .split("\n")
        .map((l) => l.replace(/^\s*[•\-\*]\s*/, "").trim())
        .filter((l) => l.length > 0)
        .slice(0, 3);
      cache.set(data.id, { bullets, at: Date.now() });
      return { bullets };
    } catch {
      return { bullets: [] };
    }
  });
