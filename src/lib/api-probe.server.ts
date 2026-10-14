const QUESTION = "Responde só com a palavra pong.";

async function ask(name: string, run: () => Promise<{ status: number; text: string }>) {
  const started = Date.now();
  try {
    const { status, text } = await run();
    const said = text.replace(/\s+/g, " ").trim().slice(0, 80);
    return { api: name, status, respondeu: said.length > 0, disse: said, ms: Date.now() - started };
  } catch (error) {
    return { api: name, status: 0, respondeu: false, disse: error instanceof Error ? error.message.slice(0, 80) : "falhou", ms: Date.now() - started };
  }
}

function clip(body: string): string {
  try {
    const data = JSON.parse(body) as {
      choices?: { message?: { content?: string | null } }[];
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      result?: { response?: string };
      error?: { message?: string };
      errors?: { message?: string }[];
    };
    return data.choices?.[0]?.message?.content
      || data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("")
      || data.result?.response
      || data.error?.message
      || data.errors?.[0]?.message
      || body.slice(0, 80);
  } catch {
    return body.slice(0, 80);
  }
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeout = 8_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    return { status: response.status, text: clip(await response.text()) };
  } finally {
    clearTimeout(timer);
  }
}

/** Um pedido curto a cada API. Não grava notícias e não mostra chaves. */
export async function probeTitleApis() {
  const groqModel = "llama-3.1-8b-instant";
  const openrouterModel = "google/gemma-4-31b-it:free";
  const nvidiaModel = "google/gemma-4-31b-it";
  const cloudflareModel = "@cf/meta/llama-3.1-8b-instruct-fp8";
  const results = await Promise.all([
    ask("groq", () => {
      const key = process.env["GROQ_API_KEY"];
      if (!key) return Promise.resolve({ status: 0, text: "chave em falta" });
      return post("https://api.groq.com/openai/v1/chat/completions", { authorization: `Bearer ${key}`, "content-type": "application/json" }, {
        model: groqModel, max_tokens: 20, temperature: 0, messages: [{ role: "user", content: QUESTION }],
      });
    }),
    ask("gemini", () => {
      const key = process.env["GEMINI_API_KEY"];
      if (!key) return Promise.resolve({ status: 0, text: "chave em falta" });
      return post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent`, { "content-type": "application/json", "x-goog-api-key": key }, {
        contents: [{ role: "user", parts: [{ text: QUESTION }] }],
      });
    }),
    ask("openrouter", () => {
      const key = process.env["OPENROUTER_API_KEY"];
      if (!key) return Promise.resolve({ status: 0, text: "chave em falta" });
      return post("https://openrouter.ai/api/v1/chat/completions", { authorization: `Bearer ${key}`, "content-type": "application/json" }, {
        model: openrouterModel, max_tokens: 20, temperature: 0, messages: [{ role: "user", content: QUESTION }],
      });
    }),
    ask("nvidia", () => {
      const key = process.env["NVIDIA_API_KEY"];
      if (!key) return Promise.resolve({ status: 0, text: "chave em falta" });
      return post("https://integrate.api.nvidia.com/v1/chat/completions", { authorization: `Bearer ${key}`, "content-type": "application/json" }, {
        model: nvidiaModel, max_tokens: 20, temperature: 0, messages: [{ role: "user", content: QUESTION }],
      });
    }),
    ask("cloudflare", () => {
      const token = process.env["CLOUDFLARE_API_TOKEN"];
      const account = process.env["CLOUDFLARE_ACCOUNT_ID"];
      if (!token || !account) return Promise.resolve({ status: 0, text: "chave em falta" });
      return post(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${cloudflareModel}`, { authorization: `Bearer ${token}`, "content-type": "application/json" }, {
        max_tokens: 20, temperature: 0, messages: [{ role: "user", content: QUESTION }],
      });
    }),
  ]);
  return { probe: true, results };
}
