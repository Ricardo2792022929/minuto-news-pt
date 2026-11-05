"""Temporário: recolhe screenshots e dados públicos de apps de notícias na Google Play (referências de design)."""
import json, os, re, sys, time, urllib.request, urllib.parse, html

OUT = "refs"
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8"}

def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")

SEARCHES = [
    ("notícias", 8), ("notícias portugal", 6), ("jornal", 5), ("news", 8), ("breaking news", 4),
    ("observador", 1), ("público jornal", 1), ("expresso", 1), ("sic notícias", 1), ("rtp notícias", 1),
    ("cnn portugal", 1), ("notícias ao minuto", 1), ("sapo", 1), ("ground news", 1), ("squid news", 1),
    ("flipboard", 1), ("smartnews", 1), ("inshorts", 1), ("bbc news", 1), ("newsbreak", 1),
]
SEED = ["com.google.android.apps.magazines", "flipboard.app", "jp.gocro.smartnews.android", "bbc.mobile.news.ww",
        "com.guardian", "com.nis.app", "com.particlenews.newsbreak", "com.microsoft.amp.apps.bingnews"]

ids = []
def add(i):
    if i not in ids:
        ids.append(i)

for q, n in SEARCHES:
    url = "https://play.google.com/store/search?" + urllib.parse.urlencode({"q": q, "c": "apps", "hl": "pt_PT", "gl": "PT"})
    try:
        page = get(url)
    except Exception as e:
        print("search fail", q, e); continue
    found = []
    for m in re.finditer(r'/store/apps/details\?id=([A-Za-z0-9_.]+)', page):
        if m.group(1) not in found:
            found.append(m.group(1))
    print("search", q, found[:n])
    for i in found[:n]:
        add(i)
    time.sleep(0.6)
for i in SEED:
    add(i)

apps = []
for pkg in ids[:40]:
    url = "https://play.google.com/store/apps/details?" + urllib.parse.urlencode({"id": pkg, "hl": "pt_PT", "gl": "PT"})
    try:
        page = get(url)
    except Exception as e:
        print("details fail", pkg, e); continue
    info = {"id": pkg}
    for block in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', page, re.S):
        try:
            j = json.loads(block)
        except Exception:
            continue
        if isinstance(j, dict) and j.get("@type") == "SoftwareApplication":
            info["name"] = j.get("name")
            info["category"] = j.get("applicationCategory")
            ar = j.get("aggregateRating") or {}
            info["rating"] = ar.get("ratingValue"); info["ratings"] = ar.get("ratingCount")
            info["dev"] = (j.get("author") or {}).get("name")
    m = re.search(r'<h1[^>]*>(.*?)</h1>', page, re.S)
    if m and not info.get("name"):
        info["name"] = html.unescape(re.sub("<[^>]+>", "", m.group(1)))
    m = re.search(r'([\d\s.,]+(?:mil|M|K)?\+)\s*</div>\s*<div[^>]*>\s*Downloads', page)
    if m:
        info["installs"] = m.group(1).strip()
    shots = []
    for m in re.finditer(r'<img[^>]+>', page):
        tag = m.group(0)
        if "play-lh.googleusercontent.com" not in tag:
            continue
        alt = re.search(r'alt="([^"]*)"', tag)
        alt = alt.group(1).lower() if alt else ""
        if "captura" in alt or "screenshot" in alt:
            src = re.search(r'src="([^"]+)"', tag).group(1)
            base = src.split("=")[0]
            if base not in shots:
                shots.append(base)
    info["shots"] = len(shots)
    folder = os.path.join(OUT, pkg)
    os.makedirs(folder, exist_ok=True)
    for k, base in enumerate(shots[:8]):
        try:
            data = get(base + "=w720-h1440", binary=True)
            with open(os.path.join(folder, f"{k+1:02d}.webp"), "wb") as f:
                f.write(data)
        except Exception as e:
            print("img fail", pkg, k, e)
    print(json.dumps(info, ensure_ascii=False))
    apps.append(info)
    time.sleep(0.6)

with open(os.path.join(OUT, "apps.json"), "w") as f:
    json.dump(apps, f, ensure_ascii=False, indent=1)
