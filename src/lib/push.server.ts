import { createSign } from "node:crypto";

const PROJECT_ID = "project-4033179589554394532";
const TOPIC = "flash-importantes";

const IMPORTANT = [
  "morre", "morreu", "morto", "mortos", "mata", "matou", "assassin", "tragedia",
  "ataque", "guerra", "bomba", "explos", "sismo", "terramoto", "incendio",
  "detid", "preso", "prisao", "crime", "assalt", "roubo", "homicid", "conden",
  "demite", "demissao", "urgente", "alerta", "acidente", "despiste",
  "inund", "tempestade", "colaps", "crise", "greve",
  "governo", "presidente", "eleicoes", "parlamento", "orcamento", "ministro", "assembleia", "inflac",
  "ucrania", "gaza", "israel", "nato", "russia", "putin",
];

const SKIP = ["horoscopo", "receita", "passatempo", "publicidade", "podcast"];

type Account = { client_email: string; private_key: string };
type Story = { title: string; url: string; publishedAt: string };

let cached: { token: string; exp: number } | null = null;

function account(): Account | null {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT"];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Account>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(): Promise<string | null> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const sa = account();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claim}`);
  sign.end();
  const jwt = `${header}.${claim}.${b64url(sign.sign(sa.private_key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) return null;
  cached = { token: data.access_token, exp: Date.now() + 50 * 60_000 };
  return data.access_token;
}

function plain(title: string): string {
  return title.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function importance(title: string): number {
  const text = plain(title);
  if (SKIP.some((word) => text.includes(word))) return 0;
  let score = 0;
  for (const word of IMPORTANT) if (text.includes(word)) score += 1;
  return score;
}

async function send(title: string, url: string): Promise<"sent" | "rejected" | "no-key"> {
  const token = await accessToken();
  if (!token) return "no-key";
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        topic: TOPIC,
        notification: { title: "Flash Notícias", body: title.slice(0, 180) },
        data: { url },
        android: {
          priority: "HIGH",
          notification: { channel_id: "news", sound: "default" },
        },
      },
    }),
  });
  return res.ok ? "sent" : "rejected";
}

export async function notifyImportant(items: Story[]): Promise<"sent" | "none" | "no-key" | "rejected"> {
  const now = Date.now();
  const ranked = items
    .filter((item) => now - new Date(item.publishedAt).getTime() < 90 * 60_000)
    .map((item) => ({ item, score: importance(item.title) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.item.publishedAt.localeCompare(a.item.publishedAt));
  const best = ranked[0]?.item;
  if (!best) return "none";
  return send(best.title, best.url);
}

export async function subscribeToken(device: string): Promise<"ok" | "no-key" | "rejected"> {
  const token = await accessToken();
  if (!token) return "no-key";
  const res = await fetch("https://iid.googleapis.com/iid/v1:batchAdd", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      access_token_auth: "true",
    },
    body: JSON.stringify({ to: `/topics/${TOPIC}`, registration_tokens: [device] }),
  });
  return res.ok ? "ok" : "rejected";
}
