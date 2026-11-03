import { createSign } from "node:crypto";

const PROJECT_ID = "project-4033179589554394532";
const TOPIC = "flash-importantes";

const STRONG = [
  "morre", "morreu", "morto", "mortos", "mata", "matou", "assassin", "tragedia",
  "ataque", "guerra", "bomba", "explos", "sismo", "terramoto", "incendio",
  "homicid", "acidente", "despiste", "inund", "tempestade", "colaps", "alerta", "urgente",
];

const SOFT = [
  "detid", "preso", "prisao", "crime", "assalt", "roubo", "conden",
  "demite", "demissao", "greve", "crise",
  "governo", "presidente", "eleicoes", "parlamento", "orcamento", "ministro", "assembleia", "inflac",
  "ucrania", "gaza", "israel", "nato", "russia", "putin",
];

const SKIP = ["horoscopo", "receita", "passatempo", "publicidade", "podcast"];

type Account = { client_email: string; private_key: string };
type Story = { title: string; url: string; publishedAt: string; image?: string | null };

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
  for (const word of STRONG) if (text.includes(word)) score += 2;
  for (const word of SOFT) if (text.includes(word)) score += 1;
  return score;
}

function noticeImage(raw: string | null | undefined): string | undefined {
  if (!raw || !raw.startsWith("https://") || raw.includes("ik.imagekit.io")) return undefined;
  return `https://ik.imagekit.io/1aur3rser/tr:w-1200,ar-16-9,fo-auto,q-70,f-jpg/${raw}`;
}

async function send(title: string, url: string, image?: string | null): Promise<"sent" | "rejected" | "no-key"> {
  const token = await accessToken();
  if (!token) return "no-key";
  const picture = noticeImage(image);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        topic: TOPIC,
        notification: {
          title: "Flash Notícias",
          body: title.slice(0, 180),
          ...(picture ? { image: picture } : {}),
        },
        data: { url },
        android: {
          priority: "HIGH",
          notification: {
            channel_id: "news",
            sound: "default",
            ...(picture ? { image: picture } : {}),
          },
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
    .filter((row) => row.score >= 2)
    .sort((a, b) => b.score - a.score || b.item.publishedAt.localeCompare(a.item.publishedAt));
  const best = ranked[0]?.item;
  if (!best) return "none";
  return send(best.title, best.url, best.image);
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
