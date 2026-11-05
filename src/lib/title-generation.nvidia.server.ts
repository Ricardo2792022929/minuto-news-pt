import { GatewayError, NVIDIA_LIMIT, recordFailure, recordSample, tryAcquire, validTitle, type GeneratedTitle } from "./title-generation.server";

const MODEL = "google/gemma-4-31b-it";
const TIMEOUT_MS = 8_000;
let nvidiaCooldownUntil = 0;

const SYSTEM = `És o editor do Flash Notícias. O título é o texto sobre a imagem num feed vertical de telemóvel. Tem de ser lido em menos de 2 segundos e dizer exactamente o que aconteceu.

REGRAS DO TÍTULO:
- Português de Portugal. Diz golo e equipa, não gol nem time.
- 6 a 10 palavras. Máximo 10. Uma frase completa e fechada, com verbo. Se não couber, escreve só a primeira oração completa. Nunca cortes a meio.
- Afirmativo. Nunca uma pergunta: a pergunta esconde o que aconteceu. Nunca dois-pontos. Nunca prefixos (Urgente, Crise, Atenção, Última hora).
- Escreve como se contasses a notícia a alguém, numa frase falada. Ordem normal: quem, o que fez, o resultado. Não inverta a frase só para ficar diferente.
- O sujeito é o mesmo do original. Se o Nacional perde, o título não pode dizer que o Benfica lamenta. Não troques vencedor e vencido.
- Um facto, não o contexto. Sem adjetivos vazios (chocante, incrível, histórico).
- Não inventes mortos, números, nomes ou acusações que não estejam no original.
- Termos de futebol: biza = 2 golos, hat-trick = 3 golos, póquer = 4 golos. Se o original diz "biza", escreve "marca dois golos", nunca outro número.
- Não inventes um confronto. Se o original não fala de um jogo entre dois clubes, não escrevas que um "abala" ou "vence" o outro.
- Não copies a frase original. Diz o mesmo facto com outras palavras, na ordem em que se fala. Nunca deixes o título igual ao original nem só o original cortado.
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
export async function generateNvidiaOne(title: string, articleText?: string | null): Promise<GeneratedTitle | null> {
  const apiKey = process.env["NVIDIA_API_KEY"];
  if (!apiKey) { recordFailure("nvidia", "sem chave"); return null; }
  if (Date.now() < nvidiaCooldownUntil) { recordFailure("nvidia", "em pausa"); return null; }

  const release = tryAcquire("nvidia", NVIDIA_LIMIT);
  if (!release) { recordFailure("nvidia", "limite próprio"); return null; }
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
          { role: "user", content: `O título original é só a indicação. Conta esse facto como se o dissesses a alguém, numa frase nova, em português de Portugal, de 6 a 10 palavras. Ordem normal, sem inverter a frase e sem fazer uma pergunta. Não copies nem cortes o original. Não acrescentes números nem detalhes que o original não tem. Não uses abala, chocante ou incrível. Usa o texto da notícia para perceber o contexto.\nIncorreto: Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas\nCorreto: Sánchez dissolve o parlamento e marca eleições\nTítulo original: ${title}${articleText ? `\nTexto da notícia: ${articleText.slice(0, 800)}` : ""}` },
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
      recordFailure("nvidia", `HTTP ${response.status}`);
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
    const titulo = parsed && validTitle(parsed.titulo, title, articleText);
    if (!titulo) {
      console.warn("NVIDIA devolveu título inválido");
      recordFailure("nvidia", parsed ? "título recusado" : "sem JSON");
      if (parsed) recordSample("nvidia", parsed.titulo);
      return null;
    }
    return { titulo, resumo: (parsed && validSummary(parsed.resumo)) || titulo };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    console.error("NVIDIA falhou", error instanceof Error ? error.message : error);
    recordFailure("nvidia", `falhou ${error instanceof Error ? error.name : "erro"}`);
    return null;
  } finally {
    clearTimeout(timer);
    release();
  }
}

/** Lote: um pedido com várias notícias. Devolve o texto em bruto (JSON) ou null. */
export async function askNvidiaRaw(system: string, user: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env["NVIDIA_API_KEY"];
  if (!apiKey) { recordFailure("nvidia", "sem chave"); return null; }
  if (Date.now() < nvidiaCooldownUntil) { recordFailure("nvidia", "em pausa"); return null; }
  const release = tryAcquire("nvidia", NVIDIA_LIMIT);
  if (!release) { recordFailure("nvidia", "limite próprio"); return null; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) {
      if (response.status === 429 || response.status === 401 || response.status === 403) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        nvidiaCooldownUntil = Date.now() + (retryAfter > 0 ? Math.min(retryAfter, 7200) * 1000 : 15 * 60_000);
      }
      recordFailure("nvidia", `HTTP ${response.status}`);
      return null;
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[] };
    const message = payload.choices?.[0]?.message;
    const raw = message?.content || message?.reasoning_content || message?.reasoning || "";
    if (!raw.includes("{")) { recordFailure("nvidia", "sem JSON"); return null; }
    return raw;
  } catch (error) {
    recordFailure("nvidia", `falhou ${error instanceof Error ? error.name : "erro"}`);
    return null;
  } finally {
    clearTimeout(timer);
    release();
  }
}
