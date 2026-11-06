/**
 * Lê o corpo de uma resposta só até `maxBytes` e cancela o resto.
 * Páginas de notícias com 2–5 MB de HTML, lidas às dezenas em paralelo, faziam a ronda passar
 * o limite de memória/CPU do servidor (Cloudflare "error code: 1102") e a ronda inteira falhava.
 */
export async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return (await res.text()).slice(0, maxBytes);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let read = 0;
  try {
    while (read < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const chunk = read + value.byteLength > maxBytes ? value.subarray(0, maxBytes - read) : value;
      read += chunk.byteLength;
      out += decoder.decode(chunk, { stream: true });
    }
    out += decoder.decode();
  } finally {
    reader.cancel().catch(() => {});
  }
  return out;
}
