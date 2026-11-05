// Base de dados falsa (imita o PostgREST do Supabase) só para tirar as capturas da Play Store.
// Lê scripts/loja/demo.json e responde às consultas do feed. Não guarda nada.
import http from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_PORT || 54321);
const NOW = Date.parse(process.env.DEMO_NOW || new Date().toISOString());
const demo = JSON.parse(readFileSync(new URL("./demo.json", import.meta.url), "utf8"));

function rows() {
  return demo.map((item, index) => ({
    id: item.id || `demo-${index + 1}`,
    source: item.source,
    category: item.category,
    url: item.url || `https://exemplo.pt/noticia-${index + 1}`,
    image: item.image ? `https://fotos.demo/${item.image}` : null,
    image_query: null,
    image_status: item.image ? "original" : null,
    image_candidates: [],
    titulo_inedito: item.title,
    resumo: item.summary || item.title,
    original_title: item.original || null,
    published_at: new Date(NOW - item.minutes * 60_000).toISOString(),
    related: item.related || null,
  }));
}

function unquote(value) {
  return value.replace(/^"|"$/g, "");
}

function applyFilters(list, params) {
  let out = list;
  for (const [key, raw] of params) {
    if (["select", "order", "offset", "limit"].includes(key)) continue;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    if (op === "eq") out = out.filter((row) => String(row[key]) === unquote(value));
    else if (op === "in") {
      const set = new Set(value.replace(/^\(|\)$/g, "").split(",").map(unquote));
      out = out.filter((row) => set.has(String(row[key])));
    } else if (op === "gte") out = out.filter((row) => String(row[key]) >= unquote(value));
    else if (op === "lte") out = out.filter((row) => String(row[key]) <= unquote(value));
  }
  return out;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 204;
    return res.end();
  }
  if (!url.pathname.startsWith("/rest/v1/articles")) {
    res.statusCode = 200;
    return res.end("[]");
  }
  let list = applyFilters(rows(), url.searchParams);
  list.sort((a, b) => b.published_at.localeCompare(a.published_at) || a.id.localeCompare(b.id));
  const total = list.length;
  let offset = Number(url.searchParams.get("offset") || 0);
  let limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : total;
  const range = req.headers["range"];
  if (range && /^\d+-\d+$/.test(range)) {
    const [a, b] = range.split("-").map(Number);
    offset = a;
    limit = b - a + 1;
  }
  const page = list.slice(offset, offset + limit);
  const end = page.length ? offset + page.length - 1 : offset;
  res.setHeader("Content-Range", `${offset}-${end}/${total}`);
  res.statusCode = 200;
  res.end(JSON.stringify(page));
});

server.listen(PORT, "127.0.0.1", () => console.log(`base falsa em http://127.0.0.1:${PORT} com ${demo.length} notícias`));
