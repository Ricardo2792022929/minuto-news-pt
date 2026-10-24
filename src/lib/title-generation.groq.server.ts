import { GatewayError, validTitle, type GeneratedTitle } from "./title-generation.server";

const MODEL = process.env["GROQ_MODEL"] || "openai/gpt-oss-20b";
const TIMEOUT_MS = 6_000;
const groqCooldownUntil = [0, 0];
let groqTurn = 0;

function groqAccounts(): { key: string; slot: number }[] {
  const first = process.env["GROQ_API_KEY"];
  const second = process.env["GROQ_API_KEY_2"] || process.env["GROQ_API_KEY2"];
  return [
    first ? { key: first, slot: 0 } : null,
    second ? { key: second, slot: 1 } : null,
  ].filter((account): account is { key: string; slot: number } => Boolean(account));
}

const SYSTEM = `És o editor do Flash Notícias. O título é o texto sobre a imagem num feed vertical de telemóvel. Tem de ser lido em menos de 2 segundos e dizer exactamente o que aconteceu.

REGRAS DO TÍTULO:
- Português de Portugal. Diz golo e equipa, não gol nem time.
- 6 a 10 palavras. Máximo 10. Uma frase completa e fechada, com verbo. Se não couber, escreve só a primeira oração completa. Nunca cortes a meio.
- Afirmativo. Nunca uma pergunta: a pergunta esconde o que aconteceu. Nunca dois-pontos. Nunca prefixos (Urgente, Crise, Atenção, Última hora).
- Escreve como se contasses a notícia a alguém, numa frase falada. Ordem normal: quem, o que fez, o resultado. Não inverta a frase só para ficar diferente.
- O sujeito é o mesmo do original. Se o Nacional perde, o título não pode dizer que o Benfica lamenta. Não troques vencedor e vencido.
- Um facto, não o contexto. O interesse vem de um detalhe que já está na notícia: o resultado, o sítio ou o que a pessoa disse. Sem adjetivos vazios (chocante, incrível, histórico) e sem verbos de efeito (abala, mexe, marca).
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

/** Gera título e resumo através da API Groq. Alterna as duas contas e só pausa a que falhou. */
export async function generateGroqOne(title: string, articleText?: string | null): Promise<GeneratedTitle | null> {
  const accounts = groqAccounts();
  if (!accounts.length) throw new GatewayError("GROQ_API_KEY em falta", 401);
  const prompt = `O título original é só a indicação. Conta esse facto como se o dissesses a alguém, numa frase nova, em português de Portugal, de 6 a 10 palavras. Ordem normal, sem inverter a frase e sem fazer uma pergunta. Não copies nem cortes o original. Não acrescentes números nem detalhes que o original não tem. Não uses abala, chocante ou incrível. Usa o texto da notícia para perceber o contexto.\nIncorreto: Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas\nCorreto: Sánchez dissolve o parlamento e marca eleições\nTítulo original: ${title}${articleText ? `\nTexto da notícia: ${articleText.slice(0, 800)}` : ""}`;
  const start = groqTurn % accounts.length;
  let blocked = 0;
  for (let step = 0; step < accounts.length; step += 1) {
    const account = accounts[(start + step) % accounts.length];
    if (Date.now() < groqCooldownUntil[account.slot]) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${account.key}`, "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.8,
          max_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        if (response.status === 429 || response.status === 401 || response.status === 403 || response.status === 402) {
          const retryAfter = Number(response.headers.get("retry-after") ?? 0);
          groqCooldownUntil[account.slot] = Date.now() + (retryAfter > 0 ? Math.min(retryAfter, 7200) * 1000 : 15 * 60_000);
        }
        console.error("Groq HTTP", response.status, detail);
        if (response.status === 401 || response.status === 403 || response.status === 402) blocked += 1;
        continue;
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string | null; reasoning?: string | null } }[];
      };
      const message = payload.choices?.[0]?.message;
      const raw = message?.content || message?.reasoning || "";
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      if (jsonStart < 0 || jsonEnd <= jsonStart) continue;
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as { titulo?: unknown; resumo?: unknown };
      const titulo = validTitle(parsed.titulo, title, articleText);
      if (!titulo) {
        console.warn("Groq devolveu título inválido");
        continue;
      }
      groqTurn = account.slot + 1;
      return { titulo, resumo: validSummary(parsed.resumo) || titulo };
    } catch (error) {
      console.error("Groq falhou", error instanceof Error ? error.message : error);
    } finally {
      clearTimeout(timer);
    }
  }
  if (blocked === accounts.length) throw new GatewayError("Groq HTTP 401", 401);
  return null;
}
