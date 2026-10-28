"""API16 news collector — Venezuela oil & gas headlines from public RSS feeds.

Keeps headline, source, date and link only (no article text). Runs on a schedule
(GitHub Actions). No keys needed. Output: tracker/data/news.json (newest first).

Hand-picked stories live in tracker/curated.json (small file, easy to edit from the
GitHub app). They are merged into news.json on every run and are never trimmed.
"""
import email.utils, hashlib, json, os, re, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "news.json")
CURATED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "curated.json")
MAX_ITEMS = 800
UA = {"User-Agent": "API16-news-collector/0.1 (+https://github.com/API16data/api16-merey-feed)"}


def gnews(q, lang):
    if lang == "es":
        return ("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:7d")
                + "&hl=es-419&gl=VE&ceid=VE:es-419")
    return "https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:7d") + "&hl=en-US&gl=US&ceid=US:en"


# (name, url, needs_keyword_filter)
FEEDS = [(f"Google News: {q}", gnews(q, "en"), False) for q in [
    "Venezuela oil", "PDVSA", "Venezuelan crude", "Chevron Venezuela", "OFAC Venezuela",
    "Orinoco Belt", "Venezuela oil exports tanker", "Venezuela bonds restructuring"]]
FEEDS += [(f"Google News ES: {q}", gnews(q, "es"), False) for q in [
    "PDVSA petróleo", "petróleo venezolano", "crudo Merey", "Faja del Orinoco", "empresas mixtas PDVSA"]]
FEEDS += [
    ("Banca y Negocios", "https://www.bancaynegocios.com/feed/", True),
    ("OilPrice.com", "https://oilprice.com/rss/main", True),
    ("OFAC recent actions", "https://ofac.treasury.gov/system/files/126/ofac.xml", True),
]

RELEVANT = re.compile(r"venezuel|pdvsa|merey|orinoco|maracaibo|zulia|monagas|anzo[aá]tegui|petrozamora|nabep|boscan|boscán|hamaca", re.I)
CATEGORIES = [
    ("Sanctions", r"ofac|sanction|sancion|general license|licencia general|licencia"),
    ("Debt", r"\bbond|debt|creditor|deuda|bonos|acreedor|restructur|reestructur"),
    ("Refining", r"refiner|refiner[ií]a|cardon|cardón|amuay|el palito|puerto la cruz"),
    ("Exports", r"export|cargo|tanker|shipment|import|exporta|cargament|buque|tanquero|importaci"),
    ("Production", r"production|output|b/d|bpd|barrels a day|producci[oó]n|barriles|rig\b|taladro"),
    ("Investment", r"invest|deal|contract|agreement|inversi[oó]n|contrato|acuerdo|stake|participaci"),
    ("Pricing", r"price|merey|brent|precio|cesta|discount|descuento"),
    ("Gas", r"\bgas\b|lng|gnl"),
]


def categorize(text):
    for name, pat in CATEGORIES:
        if re.search(pat, text, re.I):
            return name
    return "General"


def key(title):
    return re.sub(r"[^a-z0-9]", "", title.lower())[:80]


def parse(name, raw, filt):
    items = []
    root = ET.fromstring(raw)
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        src_el = it.find("source")
        source = (src_el.text or "").strip() if src_el is not None and src_el.text else name
        if src_el is not None and title.endswith(" - " + source):
            title = title[: -len(" - " + source)]
        if not title or not link.startswith("http"):
            continue
        if filt and not RELEVANT.search(title + " " + (it.findtext("description") or "")):
            continue
        try:
            dt = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "")
            date = dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
        except (TypeError, ValueError):
            date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
        items.append({"id": hashlib.sha1(key(title).encode()).hexdigest()[:12], "date": date, "title": title,
                      "source": source, "url": link, "category": categorize(title), "via": name, "origin": "rss"})
    return items


# ---------- highlights: the 5 stories shown on the home page ----------
# English only, no repeats, no political headlines, ranked by what they mean for API16.
POLITICS = re.compile(r"\btrump\b|51st state|\brally\b|election|maduro|machado|opposition|democrat|republican|senator|"
                      r"congress|campaign|protest|military|troops|invasion|regime|prisoner|deport|migra|chavis|cabello|"
                      r"\bvote\b|impeach|coup|human rights|cartel|narco", re.I)
NUMERIC = re.compile(r"\d[\d,.]*\s*(?:k|m|million|billion|bn)?\s*(?:b/d|bpd|barrels|bbl|boe)|"
                     r"(?:us)?\$\s?\d[\d,.]*\s*(?:k|m|bn|b|million|billion)?|\b\d+(?:\.\d+)?\s*(?:million|billion)\b|\d+(?:\.\d+)?\s*%", re.I)
FIGURE = re.compile(r"(?:us)?\$\s?\d[\d,.]*\s*(?:bn|b|billion|million|m)?|\d[\d,.]*\s*(?:k|m|million)?\s*(?:b/d|bpd|barrels|bbl|boe(?:/d)?)|"
                     r"\d+(?:\.\d+)?\s*%", re.I)
ES_WORDS = re.compile(r"\b(?:de|del|la|las|el|los|y|en|para|por|con|petr[oó]leo|crudo|millones|barriles|que)\b", re.I)
EN_WORDS = re.compile(r"\b(?:the|of|to|in|and|for|with|oil|crude|million|barrels|says|on|as)\b", re.I)
WEIGHT = {"Exports": 5, "Production": 5, "Sanctions": 5, "Pricing": 4, "Investment": 3, "Refining": 3, "Gas": 3,
          "Services": 3, "Policy": 2, "Debt": 2}
ANGLE = {
    "Exports": "Cargo flow: the barrels API16 tracks and verifies",
    "Production": "More supply: more barrels heading to market",
    "Sanctions": "Market access: who can buy and finance cargoes",
    "Pricing": "Moves the value of every Venezuelan barrel",
    "Investment": "Future barrels in the pipeline",
    "Refining": "Domestic runs vs. barrels available for export",
    "Gas": "A second export stream beyond crude",
    "Services": "Field activity ramping up: more output ahead",
    "Policy": "Sets the rules for new barrels",
    "Debt": "Claims on future oil revenue",
}
REPUTABLE = re.compile(r"reuters|bloomberg|argus|s&p|platts|eia|ofac|financial times|wall street|wsj|cnbc|kpler|vortexa|"
                       r"oilprice|world oil|rigzone|hellenic shipping|lloyd|offshore|upstream|energy intelligence", re.I)
ENTITIES = ["eni", "chevron", "repsol", "nabep", "citgo", "exxon", "reliance", "shell", "maurel", "weatherford", "slb",
            "halliburton", "sulzer", "ofac", "petrozamora", "junin", "junín", "perla", "cardon", "cardón", "amuay",
            "texas", "corpus christi", "india", "china", "spain"]
MAX_PER_CATEGORY = 2
ALIAS = {"corpus christi": "texas", "junín": "junin", "cardón": "cardon"}
MILESTONE = re.compile(r"\brestart|\bresum|\bfirst\b|\brecord\b|\bhighest\b|\blaunch|\barriv|\bstarts?\b|\bapprov|\bsign|\bawarded|\bnew license|\bdrilling campaign", re.I)
STOP = set("venezuela venezuelan venezuelas oil crude says said with from that this will after over into amid more than "
           "their about could would first new pdvsa barrels".split())


def is_english(it):
    if it.get("origin") == "curated":
        return True
    via = it.get("via", "")
    if via.startswith("Google News ES") or via == "Banca y Negocios":
        return False
    t = it["title"]
    return len(EN_WORDS.findall(t)) >= len(ES_WORDS.findall(t))


def words(t):
    return {w for w in re.findall(r"[a-z0-9áéíóúñ$]+", t.lower()) if len(w) > 3 and w not in STOP}


def highlights(items, now, n=5):
    def age_days(it):
        try:
            d = datetime.strptime(it["date"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
        except ValueError:
            return 99
        return max(0.0, (now - d).total_seconds() / 86400)

    def score(it):
        sc = WEIGHT.get(it.get("category"), 0)
        if NUMERIC.search(it["title"]):
            sc += 3
        if it.get("origin") == "curated":
            sc += 2
        if REPUTABLE.search(it.get("source", "")):
            sc += 1
        if MILESTONE.search(it["title"]):
            sc += 2
        return sc - 0.6 * age_days(it)

    pool = [i for i in items if i.get("category") in WEIGHT and is_english(i) and RELEVANT.search(i["title"])
            and (i.get("origin") == "curated" or not POLITICS.search(i["title"]))
            and not i.get("context")
            and str(i.get("url", "")).startswith("https://")]
    out = []
    for window in (4, 10, 30):
        cands = sorted((i for i in pool if age_days(i) <= window), key=lambda i: (score(i), i["date"]), reverse=True)
        out = []
        for it in cands:
            w = words(it["title"])
            ents = {ALIAS.get(e, e) for e in ENTITIES if e in it["title"].lower()}
            dup = False
            for o in out:
                ow = words(o["title"])
                if w and ow and len(w & ow) / len(w | ow) >= 0.3:
                    dup = True
                elif ents & o["_ents"] and it.get("category") == o["category"]:
                    dup = True
                if dup:
                    break
            if dup or sum(1 for o in out if o["category"] == it["category"]) >= MAX_PER_CATEGORY:
                continue
            fig = it.get("key_figure") or (FIGURE.search(it["title"]).group(0).strip() if FIGURE.search(it["title"]) else None)
            out.append({"date": it["date"], "title": it["title"], "source": it.get("source", ""), "url": it["url"],
                        "category": it["category"], "angle": ANGLE[it["category"]], "key_figure": fig, "_ents": ents})
            if len(out) == n:
                break
        if len(out) == n:
            break
    for o in out:
        o.pop("_ents")
    return out


def main():
    try:
        with open(OUT) as f:
            store = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        store = {"items": []}
    # curated.json is the single source of hand-picked items: replace the curated ones in the store
    try:
        with open(CURATED) as f:
            curated = json.load(f).get("items", [])
    except FileNotFoundError:
        curated = None
    if curated is not None:
        for c in curated:
            c.setdefault("via", "API16 curated")
            c["origin"] = "curated"
        cur_urls = {c["url"] for c in curated}
        store["items"] = [i for i in store["items"] if i.get("origin") != "curated" and i["url"] not in cur_urls] + curated
    seen = {key(i["title"]) for i in store["items"]} | {i["url"] for i in store["items"]}
    added, failed = 0, []
    for name, url, filt in FEEDS:
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                new = parse(name, r.read(), filt)
        except Exception as e:  # one bad feed must not stop the others
            failed.append(f"{name}: {type(e).__name__}")
            continue
        for it in new:
            k = key(it["title"])
            if k in seen or it["url"] in seen:
                continue
            seen.update([k, it["url"]])
            store["items"].append(it)
            added += 1
    store["items"].sort(key=lambda i: i["date"], reverse=True)
    cur = [i for i in store["items"] if i.get("origin") == "curated"]
    rss = [i for i in store["items"] if i.get("origin") != "curated"][:max(0, MAX_ITEMS - len(cur))]
    store["items"] = sorted(cur + rss, key=lambda i: i["date"], reverse=True)
    store["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    store["highlights"] = highlights(store["items"], datetime.now(timezone.utc))
    store["feeds"] = [n for n, _, _ in FEEDS]
    store["failed_feeds"] = failed
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(store, f, indent=1, ensure_ascii=False)
    print(f"news: +{added} new, {len(store['items'])} total, {len(failed)} feeds failed {failed}")


if __name__ == "__main__":
    main()
