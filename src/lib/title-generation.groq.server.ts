import { GatewayError, validTitle, type GeneratedTitle } from "./title-generation.server";

const MODEL = "llama-3.1-8b-instant";
const TIMEOUT_MS = 6_000;
let groqCooldownUntil = 0;

const SYSTEM = `És o editor do Flash Notícias. Resumes a notícia num título novo que prenda o scroll.
- Português de Portugal. Nunca inglês nem português do Brasil. Diz golo e equipa, não gol nem time.
- No máximo 12 palavras. O ideal são 6 a 11.
- É um resumo do facto, não o título original cortado. Escreve outra frase.
- Tom direto e tenso, mas o protagonista tem de ser o mesmo do original.
- Não atribuas uma derrota, um golo, uma frase ou uma decisão a outro clube ou pessoa. Se o Nacional perde, o título não pode dizer que o Benfica lamenta a derrota.
- Não inventes mortos, números, nomes ou acusações que não estejam no título.
- Sem prefixos e sem dois-pontos. Frase completa.
- O resumo é 1 frase curta com o facto.
- Responde só com JSON {"titulo","resumo"}.

Incorreto: {"titulo": "Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas"}
Correto: {"titulo": "Sánchez marca eleições e abala Espanha"}`;

function validSummary(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length < 20 || s.length > 300 || /[*_`#>\[\]]|\x60\x60\x60/.test(s)) return null;
  return s;
}

/** Gera título e resumo através da API Groq, exclusivamente no servidor. */
export async function generateGroqOne(title: string): Promise<GeneratedTitle | null> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new GatewayError("GROQ_API_KEY em falta", 401);
  if (Date.now() < groqCooldownUntil) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.8,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `O título original é só a indicação. Resume esse facto numa frase NOVA, em português de Portugal, até 12 palavras. Não copies nem cortes o original.\nIncorreto: Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas\nCorreto: Sánchez marca eleições e abala Espanha\nTítulo original: ${title}` },
        ],
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      if (response.status === 429 || response.status === 401 || response.status === 403 || response.status === 402) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        groqCooldownUntil = Date.now() + (retryAfter > 0 ? Math.min(retryAfter, 7200) * 1000 : 15 * 60_000);
      }
      console.error("Groq HTTP", response.status, detail);
      if (response.status === 401 || response.status === 403 || response.status === 402) {
        throw new GatewayError(`Groq HTTP ${response.status}`, response.status);
      }
      return null;
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null; reasoning?: string | null } }[];
    };
    const message = payload.choices?.[0]?.message;
    const raw = message?.content || message?.reasoning || "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { titulo?: unknown; resumo?: unknown };
    const titulo = validTitle(parsed.titulo, title);
    if (!titulo) {
      console.warn("Groq devolveu título inválido");
      return null;
    }
    const resumo = validSummary(parsed.resumo) || titulo;
    return { titulo, resumo };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    console.error("Groq falhou", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
