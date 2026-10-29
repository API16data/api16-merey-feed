"""API16 Census collector — official U.S. imports of Venezuelan crude by customs port, monthly.

Source: U.S. Census Bureau international trade API, imports by port and HS code
(timeseries/intltrade/imports/porths). HS 2709 = crude petroleum; country 3070 = Venezuela.
Gives value (USD) and shipping weight (kg) of vessel imports per U.S. customs port and month.
Barrels are estimated from weight with Merey 16 density (~152.5 kg per barrel).

Needs the secret CENSUS_API_KEY. Never prints the key or the request URL.
Output: tracker/data/census_ports.json
"""
import json, os, sys, urllib.parse, urllib.request
from datetime import datetime, timezone

KEY = os.environ.get("CENSUS_API_KEY", "").strip()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "census_ports.json")
BASE = "https://api.census.gov/data/timeseries/intltrade/imports/porths"
KG_PER_BBL = 152.5  # Merey 16: 16 deg API, density ~0.959 kg/l x 159 l
START = "2025-01"


def fetch():
    params = [("get", "PORT,PORT_NAME,VES_VAL_MO,VES_WGT_MO,GEN_VAL_MO"), ("I_COMMODITY", "2709"),
              ("COMM_LVL", "HS4"), ("CTY_CODE", "3070"), ("time", "from " + START), ("key", KEY)]
    url = BASE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "API16-census/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, body = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, body = e.code, ""
    if status == 204 or not body.strip():
        return []
    if status != 200 or not body.lstrip().startswith("["):
        raise SystemExit(f"Census API answered HTTP {status} without data (check that CENSUS_API_KEY is active)")
    rows = json.loads(body)
    head, data = rows[0], rows[1:]
    return [dict(zip(head, r)) for r in data]


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def main():
    if not KEY:
        raise SystemExit("Set CENSUS_API_KEY")
    raw = fetch()
    rows = []
    for r in raw:
        kg, val = num(r.get("VES_WGT_MO")), num(r.get("VES_VAL_MO")) or num(r.get("GEN_VAL_MO"))
        if not kg and not val:
            continue
        bbl = round(kg / KG_PER_BBL) if kg else None
        rows.append({"month": r.get("time"), "port": r.get("PORT"), "port_name": (r.get("PORT_NAME") or "").title(),
                     "value_usd": round(val), "weight_kg": round(kg), "est_bbl": bbl,
                     "usd_per_bbl": round(val / bbl, 2) if bbl else None})
    rows.sort(key=lambda x: (x["month"], -(x["est_bbl"] or 0)))
    months = {}
    for r in rows:
        m = months.setdefault(r["month"], {"month": r["month"], "value_usd": 0, "est_bbl": 0, "ports": 0})
        m["value_usd"] += r["value_usd"]
        m["est_bbl"] += r["est_bbl"] or 0
        m["ports"] += 1
    for m in months.values():
        m["usd_per_bbl"] = round(m["value_usd"] / m["est_bbl"], 2) if m["est_bbl"] else None
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "source": "U.S. Census Bureau, international trade API: imports by port, HS 2709 (crude petroleum), "
                             "country Venezuela (3070). Vessel value and shipping weight; barrels estimated at "
                             f"{KG_PER_BBL} kg/bbl (Merey 16).",
                   "monthly": [months[k] for k in sorted(months)], "rows": rows}, f, indent=1)
    print(f"census: {len(rows)} port-month rows, {len(months)} months")


if __name__ == "__main__":
    main()
