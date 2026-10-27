"""API16 news collector — Venezuela oil & gas headlines from public RSS feeds.

Keeps headline, source, date and link only (no article text). Runs on a schedule
(GitHub Actions). No keys needed. Output: tracker/data/news.json (newest first).
"""
import email.utils, hashlib, json, os, re, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "news.json")
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


def main():
    try:
        with open(OUT) as f:
            store = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        store = {"items": []}
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
    store["items"] = store["items"][:MAX_ITEMS]
    store["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    store["feeds"] = [n for n, _, _ in FEEDS]
    store["failed_feeds"] = failed
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(store, f, indent=1, ensure_ascii=False)
    print(f"news: +{added} new, {len(store['items'])} total, {len(failed)} feeds failed {failed}")


if __name__ == "__main__":
    main()
