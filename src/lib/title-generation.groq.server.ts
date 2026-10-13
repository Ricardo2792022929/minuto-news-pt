import { GatewayError, validTitle, type GeneratedTitle } from "./title-generation.server";

const MODEL = process.env["GROQ_MODEL"] || "openai/gpt-oss-20b";
const TIMEOUT_MS = 6_000;
let groqCooldownUntil = 0;

const SYSTEM = `És o editor do Flash Notícias. Resumes a notícia num título novo que prenda o scroll.
- Português de Portugal.
- No máximo 10 palavras. O ideal são 6 a 9.
- É um resumo do facto, não o título original cortado. Escreve outra frase.
- Começa por quem age ou pelo choque. Tom direto, tenso e provocador.
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
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Resume o facto num título NOVO, provocador e viciante, com no máximo 10 palavras. Não copies nem cortes o título original.\nIncorreto: Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas\nCorreto: Sánchez marca eleições e abala Espanha\nTítulo original: ${title}` },
        ],
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      if (response.status === 429 || response.status === 401 || response.status === 403 || response.status === 402) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        groqCooldownUntil = Date.now() + (retryAfter > 0 ? Math.min(retryAfter, 180) * 1000 : 30_000);
      }
      console.error("Groq HTTP", response.status, detail);
      if (response.status === 401 || response.status === 403 || response.status === 402) {
        throw new GatewayError(`Groq HTTP ${response.status}`, response.status);
      }
      return null;
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { titulo?: unknown; resumo?: unknown };
    const titulo = validTitle(parsed.titulo, title);
    const resumo = validSummary(parsed.resumo);
    if (!titulo || !resumo) {
      console.warn("Groq devolveu título/resumo inválido");
      return null;
    }
    return { titulo, resumo };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    console.error("Groq falhou", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
