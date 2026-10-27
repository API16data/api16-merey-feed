"""API16 EIA collector — official U.S. data from the EIA API.

- U.S. crude imports from Venezuela by refinery and by port (EIA-814, monthly)
- U.S. crude imports from Venezuela, weekly preliminary (Weekly Petroleum Status Report)
- Brent and WTI spot prices (daily)
Needs the env var EIA_API_KEY. Never prints the key or request URLs.
Outputs in tracker/data/: eia_imports_refinery.json, eia_imports_port.json,
eia_imports_monthly.json, eia_imports_weekly.json, spot_prices_daily.json
"""
import calendar, json, os, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timezone

KEY = os.environ.get("EIA_API_KEY", "").strip()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
START_MONTH, START_DAY = "2025-01", "2025-01-01"


def get(path, params):
    rows, offset = [], 0
    while True:
        q = [("api_key", KEY)] + params + [("offset", str(offset)), ("length", "5000")]
        try:
            with urllib.request.urlopen(f"https://api.eia.gov/v2/{path}?" + urllib.parse.urlencode(q), timeout=60) as r:
                resp = json.load(r)["response"]
        except Exception as e:
            raise SystemExit(f"EIA request failed for {path}: {type(e).__name__}")
        rows += resp["data"]
        offset += len(resp["data"])
        if not resp["data"] or offset >= int(resp.get("total", 0)):
            return rows


def days(period):
    y, m = map(int, period.split("-"))
    return calendar.monthrange(y, m)[1]


def imports(dest_type, label):
    data = get("crude-oil-imports/data/", [
        ("frequency", "monthly"), ("data[]", "quantity"), ("facets[originId][]", "CTY_VE"),
        ("facets[destinationType][]", dest_type), ("start", START_MONTH),
        ("sort[0][column]", "period"), ("sort[0][direction]", "asc")])
    agg = defaultdict(float)
    grades = defaultdict(set)
    for r in data:
        agg[(r["period"], r["destinationName"])] += float(r["quantity"] or 0)
        grades[(r["period"], r["destinationName"])].add(r.get("gradeName") or "")
    out = []
    for (p, name), kbbl in sorted(agg.items()):
        out.append({"period": p, label: name.replace("Corpus Chris,", "Corpus Christi,"), "kbbl": kbbl,
                    "kbd": round(kbbl / days(p), 1), "grades": ", ".join(sorted(g for g in grades[(p, name)] if g))})
    return out


def spot(series):
    data = get("petroleum/pri/spt/data/", [
        ("frequency", "daily"), ("data[]", "value"), ("facets[series][]", series), ("start", START_DAY),
        ("sort[0][column]", "period"), ("sort[0][direction]", "asc")])
    return {r["period"]: float(r["value"]) for r in data if r.get("value") not in (None, "")}


def weekly_imports():
    data = get("petroleum/move/wimpc/data/", [
        ("frequency", "weekly"), ("data[]", "value"), ("facets[series][]", "W_EPC0_IM0_NUS-NVE_MBBLD"),
        ("start", START_DAY), ("sort[0][column]", "period"), ("sort[0][direction]", "asc")])
    rows = [{"week_ending": r["period"], "kbd": float(r["value"])} for r in data if r.get("value") not in (None, "")]
    for i, r in enumerate(rows):  # 4-week rolling average, as EIA reports it
        win = rows[max(0, i - 3): i + 1]
        r["kbd_4wk"] = round(sum(x["kbd"] for x in win) / len(win)) if len(win) == 4 else None
    return rows


def save(name, obj):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(obj, f, indent=0)


def main():
    if not KEY:
        raise SystemExit("Set EIA_API_KEY")
    os.makedirs(OUT, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ref = imports("RF", "refinery")
    port = imports("PT", "port")
    monthly = defaultdict(float)
    for r in ref:
        monthly[r["period"]] += r["kbbl"]
    save("eia_imports_refinery.json", {"updated": now, "source": "EIA API crude-oil-imports (EIA-814), origin Venezuela", "rows": ref})
    save("eia_imports_port.json", {"updated": now, "source": "EIA API crude-oil-imports (EIA-814), origin Venezuela", "rows": port})
    save("eia_imports_monthly.json", {"updated": now, "source": "Sum of refinery rows", "rows": [
        {"period": p, "kbbl": v, "kbd": round(v / days(p))} for p, v in sorted(monthly.items())]})
    save("eia_imports_weekly.json", {"updated": now, "source": "EIA Weekly Petroleum Status Report, preliminary crude imports from Venezuela (W_EPC0_IM0_NUS-NVE_MBBLD), thousand b/d", "rows": weekly_imports()})
    brent, wti = spot("RBRTE"), spot("RWTC")
    save("spot_prices_daily.json", {"updated": now, "source": "EIA spot prices: RBRTE (Brent), RWTC (WTI), USD/bbl", "rows": [
        {"date": d, "brent": brent.get(d), "wti": wti.get(d)} for d in sorted(set(brent) | set(wti))]})
    last = max(monthly) if monthly else "-"
    print(f"eia: {len(ref)} refinery rows, {len(port)} port rows, latest month {last}; {len(brent)} Brent days, {len(wti)} WTI days")


if __name__ == "__main__":
    main()
