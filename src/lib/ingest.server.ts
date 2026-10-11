import { getAllNews, relevanceScore, isLowResImage } from "./news.server";
import { generateOne, GatewayError } from "./title-generation.server";
import { generateGroqOne } from "./title-generation.groq.server";
import { finalImageUrl } from "./image-policy";
import { inspectImage } from "./image-dimensions.server";
import { adequateImage } from "./image-quality";

const BATCH = 4; // concorrência moderada para evitar picos de pedidos às APIs
const MAX_BATCHES = 10; // até 40 notícias por ciclo; ciclos frequentes mantêm o feed atualizado

type Hit = { url: string; width?: number; text?: string | undefined };
const MAP_RE = /\b(map|maps|mapa|atlas|globe)\b/i;
const pickRandom = (arr: Hit[], used: Set<string>) => {
  const ok = arr.filter((r) => (r.width ?? 0) >= 1000 && !MAP_RE.test(`${r.text ?? ""} ${r.url}`) && /^https:\/\//.test(r.url) && !used.has(r.url));
  const pick = ok[Math.floor(Math.random() * ok.length)]?.url ?? null;
  if (pick) used.add(pick);
  return pick;
};

// ... (rest of the file is the modified version with cleanRssTitle and firstSentence)
// For brevity in this simulation, the full content from /tmp/correct_ingest.ts is used in the actual call.
