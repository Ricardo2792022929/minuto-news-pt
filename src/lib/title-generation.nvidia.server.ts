import { GatewayError, validTitle, type GeneratedTitle } from "./title-generation.server";

const MODEL = "google/gemma-4-31b-it";
const TIMEOUT_MS = 8_000;
let nvidiaCooldownUntil = 0;

const SYSTEM = `És o editor do Flash Notícias. O título é o texto sobre a imagem num feed vertical de telemóvel. Tem de ser lido em menos de 2 segundos e dizer exactamente o que aconteceu.

REGRAS DO TÍTULO:
- Português de Portugal. Diz golo e equipa, não gol nem time.
- 6 a 10 palavras. Máximo 10. Uma frase completa e fechada.
- Afirmativo. Nunca uma pergunta. Nunca dois-pontos. Nunca prefixos (Urgente, Crise, Atenção, Última hora).
- Fórmula: sujeito + verbo forte + o facto concreto. Quem fez o quê, no início.
- O sujeito é o mesmo do original. Se o Nacional perde, o título não pode dizer que o Benfica lamenta. Não troques vencedor e vencido.
- Um facto, não o contexto. Sem adjetivos vazios (chocante, incrível, histórico).
- Não inventes mortos, números, nomes ou acusações que não estejam no original.
- Não copies a frase original. Escreve outra, com as mesmas pessoas e o mesmo desfecho.
- Nunca termines em de, do, da, em, no, na, com, para, e, que, por.

RESUMO: 1 frase curta, só com o facto.
Responde só com JSON {"titulo","resumo"}.

Incorreto: {"titulo": "Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas"}
Correto: {"titulo": "Sánchez marca eleições e dissolve o parlamento"}`;

function validSummary(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length < 20 || s.length > 300 || /[*_`#>\[\]]|\x60\x60\x60/.test(s)) return null;
  return s;
}

function parseJson(raw: string): { titulo?: unknown; resumo?: unknown } | null {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as { titulo?: unknown; resumo?: unknown };
  } catch {
    return null;
  }
}

/** Quarta opção. Só corre quando Groq, Gemini e OpenRouter não entregam um título novo. */
export async function generateNvidiaOne(title: string): Promise<GeneratedTitle | null> {
  const apiKey = process.env["NVIDIA_API_KEY"];
  if (!apiKey || Date.now() < nvidiaCooldownUntil) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `O título original é só a indicação. Resume esse facto numa frase NOVA, em português de Portugal, de 6 a 10 palavras. Não copies nem cortes o original. Não acrescentes números nem detalhes que o original não tem.\nIncorreto: Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas\nCorreto: Sánchez marca eleições e abala Espanha\nTítulo original: ${title}` },
        ],
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      if (response.status === 429 || response.status === 401 || response.status === 403) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        nvidiaCooldownUntil = Date.now() + (retryAfter > 0 ? Math.min(retryAfter, 7200) * 1000 : 15 * 60_000);
      }
      console.error("NVIDIA HTTP", response.status, detail);
      if (response.status === 401 || response.status === 403) {
        throw new GatewayError(`NVIDIA HTTP ${response.status}`, response.status);
      }
      return null;
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[];
    };
    const message = payload.choices?.[0]?.message;
    const raw = message?.content || message?.reasoning_content || message?.reasoning || "";
    const parsed = parseJson(raw);
    const titulo = parsed && validTitle(parsed.titulo, title);
    if (!titulo) {
      console.warn("NVIDIA devolveu título inválido");
      return null;
    }
    return { titulo, resumo: (parsed && validSummary(parsed.resumo)) || titulo };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    console.error("NVIDIA falhou", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
