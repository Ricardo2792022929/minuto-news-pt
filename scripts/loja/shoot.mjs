// Tira capturas reais da app (servidor local + base falsa) para as imagens da Play Store.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const BASE = process.env.APP_URL || "http://127.0.0.1:8080";
const OUT = process.env.SHOTS_DIR || "shots";
const PHOTOS = new URL("./fotos/", import.meta.url).pathname;
const NOW = new Date(process.env.DEMO_NOW || Date.now());
const VIEW = { width: 400, height: 866 };
const DPR = 3;
const demo = JSON.parse(readFileSync(new URL("./demo.json", import.meta.url), "utf8"));
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BLURRED = new URL("./fotos-blur/", import.meta.url).pathname;
function photoFor(url) {
  const name = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
  const file = path.join(/\/tr:[^/]*bl-/.test(url) ? BLURRED : PHOTOS, name);
  return existsSync(file) ? file : null;
}

async function newPage(browser, storage) {
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: DPR,
    isMobile: true,
    hasTouch: true,
    locale: "pt-PT",
    timezoneId: "Europe/Lisbon",
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  });
  await context.addInitScript((items) => {
    try {
      sessionStorage.setItem("flash:intro-seen", "1");
      sessionStorage.setItem("flash:city", "Lisboa");
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
    } catch {}
  }, storage);
  await context.route(/^https:\/\/(ik\.imagekit\.io|fotos\.demo)\//, async (route) => {
    const file = photoFor(route.request().url());
    if (file) await route.fulfill({ path: file, contentType: "image/jpeg" });
    else await route.fulfill({ status: 404, body: "" });
  });
  await context.route(/^https:\/\/ipwho\.is\//, (route) =>
    route.fulfill({ json: { success: true, city: "Lisboa", country_code: "PT" } }),
  );
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("consola:", msg.text().slice(0, 200));
  });
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("captura", name);
}

async function waitImages(page) {
  await page
    .waitForFunction(
      () => {
        const boxes = [...document.querySelectorAll("[data-feed-image]")];
        const visible = boxes.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        });
        return visible.length > 0 && visible.every((el) => el.querySelector("img") && el.getAttribute("aria-busy") !== "true");
      },
      null,
      { timeout: 15000 },
    )
    .catch(() => console.log("aviso: imagens não confirmadas"));
  await wait(600);
}

const toItem = (item, index) => ({
  id: item.id || `demo-${index + 1}`,
  source: item.source,
  category: item.category,
  title: item.title,
  excerpt: item.summary || item.title,
  url: item.url || `https://exemplo.pt/noticia-${index + 1}`,
  publishedAt: new Date(NOW.getTime() - item.minutes * 60_000).toISOString(),
  image: `https://fotos.demo/${item.image}`,
  imageStatus: "original",
  imageCandidates: [],
  sources: [],
});

const browser = await chromium.launch();

/* ---------- Primeira utilização ---------- */
{
  const page = await newPage(browser, {});
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Começar" }).waitFor({ timeout: 30000 });
  await wait(1600);
  await shot(page, "01-boas-vindas");

  await page.getByRole("button", { name: "Começar" }).click();
  await wait(700);
  for (const topic of ["Economia", "Mundo", "Cultura", "Desporto"]) {
    await page.getByRole("group", { name: "Temas" }).getByRole("button", { name: topic, exact: true }).click();
    await wait(250);
  }
  await wait(1200);
  await shot(page, "02-temas");

  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await wait(800);
  await page.getByRole("radio", { name: "Benfica" }).click();
  await wait(1200);
  await shot(page, "03-clube");

  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await wait(1400);
  await shot(page, "04-avisos");

  await page.getByRole("button", { name: "Agora não" }).click();
  await wait(350);
  await shot(page, "05-pronto");
  await wait(4500);
  await waitImages(page);
  await shot(page, "06-primeiro-feed");
  await page.context().close();
}

/* ---------- Feed já configurado ---------- */
const prefs = {
  "aominuto:interests": JSON.stringify(["Economia", "Mundo", "Cultura", "Desporto"]),
  "aominuto:club": "benfica",
  "aominuto:club-asked": "1",
  "flash:push-asked": "1",
};
{
  const page = await newPage(browser, prefs);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator(".feed-card").first().waitFor({ timeout: 30000 });
  await waitImages(page);
  const cards = await page.locator(".feed-card").count();
  console.log("notícias no feed:", cards);
  for (let i = 0; i < Math.min(cards, 8); i += 1) {
    await page.evaluate((index) => {
      const card = document.querySelectorAll(".feed-card")[index];
      card?.parentElement?.scrollTo({ top: card.offsetTop, behavior: "instant" });
    }, i);
    await wait(500);
    await waitImages(page);
    await shot(page, `10-feed-${String(i + 1).padStart(2, "0")}`);
    const title = await page.locator(".feed-card").nth(i).locator("h2").innerText();
    console.log("  ", i + 1, title);
  }

  // A mesma notícia em várias fontes
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".feed-card")].find((el) => /\bfontes\b/.test(el.textContent || ""));
    card?.parentElement?.scrollTo({ top: card.offsetTop, behavior: "instant" });
  });
  await wait(600);
  await waitImages(page);
  const sourcesButton = page.getByRole("button", { name: /\d+ fontes/ }).first();
  if (await sourcesButton.count()) {
    await shot(page, "11-fontes-antes");
    await sourcesButton.click();
    await wait(700);
    await shot(page, "11-fontes");
    await page.mouse.click(200, 120);
    await wait(400);
  }

  // Secções
  for (const section of ["Desporto", "Economia", "Mundo", "Política", "Cultura", "Tech"]) {
    await page.getByRole("navigation").getByRole("button", { name: section, exact: true }).click();
    await wait(1500);
    await waitImages(page);
    await shot(page, `12-seccao-${section.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()}`);
  }
  await page.context().close();
}

/* ---------- Guardar e guardadas ---------- */
{
  const saved = Object.fromEntries(
    demo
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.saved)
      .map(({ item, index }) => [item.id || `demo-${index + 1}`, toItem(item, index)]),
  );
  const page = await newPage(browser, { ...prefs, "aominuto:saved": JSON.stringify(saved) });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator(".feed-card").first().waitFor({ timeout: 30000 });
  await waitImages(page);
  const target = page.locator(".feed-card").filter({ hasText: "Caixa Geral" }).first();
  await target.evaluate((card) => card.parentElement?.scrollTo({ top: card.offsetTop, behavior: "instant" }));
  await wait(600);
  await waitImages(page);
  await target.getByRole("button", { name: /^Guardar/ }).click();
  await wait(600);
  await shot(page, "13-guardado-no-feed");
  await target.getByRole("button", { name: "Guardadas" }).click();
  await wait(1200);
  await waitImages(page);
  await shot(page, "14-guardadas");
  await page.context().close();
}

await browser.close();
