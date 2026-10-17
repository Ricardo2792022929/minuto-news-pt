import { GatewayError, validTitle, type GeneratedTitle } from "./title-generation.server";

const MODEL = process.env["CLOUDFLARE_MODEL"] || "@cf/meta/llama-3.1-8b-instruct-fp8";
const TIMEOUT_MS = 8_000;
let cloudflareCooldownUntil = 0;

const SYSTEM = `És o editor do Flash Notícias. O título é o texto sobre a imagem num feed vertical de telemóvel. Tem de ser lido em menos de 2 segundos e dizer exactamente o que aconteceu.

REGRAS DO TÍTULO:
- Português de Portugal. Diz golo e equipa, não gol nem time.
- 6 a 10 palavras. Máximo 12. Uma frase completa e fechada.
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

/** Quinta opção. Só corre quando Groq, Gemini, OpenRouter e Nvidia não entregam um título novo. */
export async function generateCloudflareOne(title: string): Promise<GeneratedTitle | null> {
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const account = process.env["CLOUDFLARE_ACCOUNT_ID"];
  if (!token || !account || Date.now() < cloudflareCooldownUntil) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODEL}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        temperature: 0.7,
        max_tokens: 180,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `O título original é só a indicação. Resume esse facto numa frase NOVA, em português de Portugal, até 12 palavras. Não copies nem cortes o original.\nIncorreto: Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas\nCorreto: Sánchez marca eleições e abala Espanha\nTítulo original: ${title}` },
        ],
      }),
    });
    const body = await response.text();
    if (!response.ok || /daily free allocation|exceeded/i.test(body.slice(0, 300))) {
      if (response.status === 429 || /daily free allocation|exceeded/i.test(body.slice(0, 300))) {
        cloudflareCooldownUntil = Date.now() + 15 * 60_000;
      }
      console.error("Cloudflare HTTP", response.status, body.slice(0, 200));
      if (response.status === 401 || response.status === 403) {
        throw new GatewayError(`Cloudflare HTTP ${response.status}`, response.status);
      }
      return null;
    }
    const payload = JSON.parse(body) as { result?: { response?: string }; response?: string };
    const raw = payload.result?.response || payload.response || "";
    const parsed = parseJson(raw);
    const titulo = parsed && validTitle(parsed.titulo, title);
    if (!titulo) {
      console.warn("Cloudflare devolveu título inválido");
      return null;
    }
    return { titulo, resumo: (parsed && validSummary(parsed.resumo)) || titulo };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    console.error("Cloudflare falhou", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
