import { GatewayError, validTitle, type GeneratedTitle } from "./title-generation.server";

const MODEL = "google/gemma-4-31b-it:free";
const TIMEOUT_MS = 8_000;
let openrouterCooldownUntil = 0;

const SYSTEM = `És o editor do Flash Notícias. O título é o texto sobre a imagem num feed vertical de telemóvel. Tem de ser lido em menos de 2 segundos e dizer exactamente o que aconteceu.

REGRAS DO TÍTULO:
- Português de Portugal. Diz golo e equipa, não gol nem time.
- 6 a 10 palavras. Máximo 10. Uma frase completa e fechada, com verbo. Se não couber, escreve só a primeira oração completa. Nunca cortes a meio.
- Afirmativo. Nunca uma pergunta. Nunca dois-pontos. Nunca prefixos (Urgente, Crise, Atenção, Última hora).
- Fórmula: sujeito + verbo forte + o facto concreto. Quem fez o quê, no início.
- O sujeito é o mesmo do original. Se o Nacional perde, o título não pode dizer que o Benfica lamenta. Não troques vencedor e vencido.
- Um facto, não o contexto. Sem adjetivos vazios (chocante, incrível, histórico).
- Não inventes mortos, números, nomes ou acusações que não estejam no original.
- Termos de futebol: biza = 2 golos, hat-trick = 3 golos, póquer = 4 golos. Se o original diz "biza", escreve "marca dois golos", nunca outro número.
- Não inventes um confronto. Se o original não fala de um jogo entre dois clubes, não escrevas que um "abala" ou "vence" o outro.
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

/** Gera título e resumo através da API OpenRouter (modelos :free), exclusivamente no servidor. */
export async function generateOpenRouterOne(title: string, articleText?: string | null): Promise<GeneratedTitle | null> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) return null;
  if (Date.now() < openrouterCooldownUntil) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "HTTP-Referer": process.env["OPENROUTER_SITE_URL"] || "https://minuto-news.pt",
        "X-Title": "FlashNoticias",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.8,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `O título original é só a indicação. Resume esse facto numa frase NOVA, em português de Portugal, de 6 a 10 palavras. Não copies nem cortes o original. Não acrescentes números nem detalhes que o original não tem. Usa o texto da notícia para perceber o contexto.\nIncorreto: Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas\nCorreto: Sánchez marca eleições e abala Espanha\nTítulo original: ${title}${articleText ? `\nTexto da notícia: ${articleText.slice(0, 800)}` : ""}` },
        ],
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      if (response.status === 429 || response.status === 401 || response.status === 403 || response.status === 402) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        openrouterCooldownUntil = Date.now() + (retryAfter > 0 ? Math.min(retryAfter, 7200) * 1000 : 15 * 60_000);
      }
      console.error("OpenRouter HTTP", response.status, detail);
      if (response.status === 401 || response.status === 403) {
        throw new GatewayError(`OpenRouter HTTP ${response.status}`, response.status);
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
      console.warn("OpenRouter devolveu título inválido");
      return null;
    }
    const resumo = validSummary(parsed.resumo) || titulo;
    return { titulo, resumo };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    console.error("OpenRouter falhou", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
