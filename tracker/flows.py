"""API16 crude flow: Venezuelan crude reaching the U.S., ship by ship, with a confidence level.

Reads Global Fishing Watch voyages (tracker/data/gfw_port_visits.json), API16's own AIS
(vessels.json, passports.json), EIA, U.S. customs and Merey prices, and keeps only voyages that
are probably crude: a large tanker that left a Venezuelan crude terminal and arrived at a U.S.
refining port. Everything else (products, LPG, asphalt, cruise, cargo) stays out of the count.

  high      crude terminal + large tanker (>= 225 m or >= 40,000 GT) + U.S. refining port
  possible  crude terminal but size unknown or mid-size tanker, or a large tanker coming from
            a storage / transfer hub (Curacao, Aruba, Bonaire, Sint Eustatius) or a refinery port
            (Amuay, Cardon) to a U.S. refining port

Volumes: the draught estimate from API16's AIS when there is one; otherwise a typical load for
the ship size and terminal (Lake Maracaibo loads are draft-limited, about 9.4 m). Every figure
carries a range and is compared, month by month, with official EIA and customs data.
Output: tracker/data/flows.json
"""
import json, os, re
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "data")
ROOT = os.path.dirname(HERE)

LAKE = re.compile(r"PUERTO MIRANDA|BAJO GRANDE|LA SALINA|MARACAIBO|PUNTA PALMAS|CABIMAS|VEMAR|VEBJV")
EAST = re.compile(r"\bJOSE\b|VE JOT|PUERTO LA CRUZ|GUARAGUAO|PUERTO JOSE")
HUB = re.compile(r"BULLEN ?BAY|WILLEMSTAD|CUW|ARUBA|ORANJESTAD|SAN NICOLAS|KRALENDIJK|BONAIRE|BOPEC|SINT EUSTATIUS|STATIA")
REFINERY_VE = re.compile(r"AMUAY|CARDON|GUARANAO|EL PALITO")
US_REFINING = re.compile(r"PORT ARTHUR|PORT NECHES|NEDERLAND|BEAUMONT|SABINE|CORPUS CHRISTI|INGLESIDE|HOUSTON|TEXAS CITY|"
                         r"GALVESTON|FREEPORT|LAKE CHARLES|CALCASIEU|PASCAGOULA|LOOP|STEUTSPASS|SOUTHWEST PASS|SOUTH ?WEST PASS|"
                         r"NEW ORLEANS|BATON ROUGE|GRAMERCY|ST\.? JAMES|GARYVILLE|CHALMETTE|MOBILE|DELAWARE|PAULSBORO|"
                         r"PHILADELPHIA|MARCUS HOOK|BAYWAY|LINDEN|USA-\d+|GOLA")


def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def cargo_from_draught(loa_m, beam_m, draught_m):
    # same model as collect.py
    if not (loa_m and draught_m) or loa_m < 100:
        return None
    area = 0.96 * loa_m * (beam_m or loa_m / 5.7)
    tonnes = 0.80 * area * draught_m * 1.025 - 2.05 * area
    return tonnes * 6.8 / 1000 if tonnes > 0 else None


def typical_kbbl(length_m, lake):
    """Typical cargo, thousand barrels, by ship length and terminal."""
    if lake:
        # draft-limited: about 9.4 m whatever the size (NAVE NEUTRINO / IONIC ANAX)
        return round(cargo_from_draught(length_m or 250, None, 9.4) or 400)
    if not length_m:
        return 650
    if length_m < 200:
        return 300      # MR / LR1
    if length_m < 265:
        return 650      # Aframax / LR2, full at Jose
    if length_m < 300:
        return 950      # Suezmax
    return 1900         # VLCC (LOOP only)


def main():
    G = load(os.path.join(D, "gfw_port_visits.json"), {}) or {}
    V = load(os.path.join(D, "vessels.json"), {}) or {}
    P = load(os.path.join(D, "passports.json"), {}) or {}
    eia_m = {r["period"]: r for r in (load(os.path.join(D, "eia_imports_monthly.json"), {}) or {}).get("rows", [])}
    eia_w = (load(os.path.join(D, "eia_imports_weekly.json"), {}) or {}).get("rows", [])
    cen = {m["month"]: m for m in (load(os.path.join(D, "census_ports.json"), {}) or {}).get("monthly", [])}
    merey = {m["month"]: m for m in (load(os.path.join(ROOT, "data", "merey_brent_monthly.json"), []) or [])}
    pp_est = {str(p["mmsi"]): p.get("est_cargo") for p in P.get("passports", []) if p.get("est_cargo")}

    recent = datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() - 21 * 86400, timezone.utc).strftime("%Y-%m-%d")
    voyages = []
    for l in G.get("tanker_legs_to_us") or G.get("legs_to_us") or []:
        if l.get("type") not in (None, "other_non_fishing"):
            continue
        src, dst = (l.get("from_port") or "").upper(), (l.get("to_port") or "").upper()
        idt = l.get("identity") or {}
        v = V.get(str(l.get("mmsi")), {})
        length = idt.get("length_m") or v.get("length_m")
        gt = idt.get("gt")
        big = bool((length and length >= 225) or (gt and gt >= 40000))
        mid = bool(length and 170 <= length < 225)
        lake, east = bool(LAKE.search(src)), bool(EAST.search(src))
        hub, vref = bool(HUB.search(src)), bool(REFINERY_VE.search(src))
        us_ref = bool(US_REFINING.search(dst))
        if not us_ref:
            continue
        if (lake or east) and big:
            conf = "high"
        elif (lake or east) and (mid or not (length or gt)):
            conf = "possible"
        elif (hub or vref) and big:
            conf = "possible"
        else:
            continue
        # API16's draught estimate belongs to the ship's current voyage only (arrivals in the last 21 days)
        est = pp_est.get(str(l.get("mmsi"))) if (l.get("arrived") or "") >= recent else None
        if est and (est.get("draught_m") or 0) > 0 and conf == "high":
            kbbl, method = est["kbbl"], f"draught {est['draught_m']} m (API16 AIS)"
        else:
            kbbl = typical_kbbl(length, lake)
            method = ("typical Lake Maracaibo load (~9.4 m)" if lake else "typical full load for the ship size")
        voyages.append({
            "name": l.get("name"), "mmsi": l.get("mmsi"), "imo": idt.get("imo"), "length_m": length, "gt": gt,
            "from_port": l.get("from_port"), "terminal": "Lake Maracaibo" if lake else "Jose / Puerto La Cruz" if east
            else "Paraguana refineries" if vref else "Caribbean hub" if hub else "other",
            "left": l.get("left"), "to_port": l.get("to_port"), "arrived": l.get("arrived"),
            "confidence": conf, "est_kbbl": kbbl, "est_low": round(kbbl * 0.8), "est_high": round(kbbl * 1.2),
            "method": method})
    voyages.sort(key=lambda x: x["arrived"] or "", reverse=True)

    months = {}
    for x in voyages:
        m = (x["arrived"] or "")[:7]
        if not m:
            continue
        r = months.setdefault(m, {"month": m, "high_n": 0, "high_kbbl": 0, "possible_n": 0, "possible_kbbl": 0})
        r[x["confidence"] + "_n"] += 1
        r[x["confidence"] + "_kbbl"] += x["est_kbbl"]
    out_months = []
    for m in sorted(months):
        r = months[m]
        y, mo = int(m[:4]), int(m[5:])
        days = (datetime(y + (mo == 12), mo % 12 + 1, 1) - datetime(y, mo, 1)).days
        r["high_kbd"] = round(r["high_kbbl"] / days)
        r["with_possible_kbd"] = round((r["high_kbbl"] + r["possible_kbbl"]) / days)
        e = eia_m.get(m)
        wk = [w for w in eia_w if (w.get("week_ending") or "")[:7] == m]
        r["eia_monthly_kbd"] = e and e.get("kbd")
        r["eia_weekly_kbd"] = round(sum(w["kbd"] for w in wk) / len(wk)) if wk else None
        c = cen.get(m)
        r["customs_kbd"] = round(c["est_bbl"] / days / 1000) if c and c.get("est_bbl") else None
        official = r["eia_monthly_kbd"] or r["customs_kbd"] or r["eia_weekly_kbd"]
        r["official_kbd"] = official
        r["coverage"] = round(r["high_kbd"] / official, 2) if official else None
        price = (merey.get(m) or {}).get("merey") or (c and c.get("usd_per_bbl"))
        r["usd_per_bbl"] = price
        r["high_value_usd"] = round(r["high_kbbl"] * 1000 * price) if price else None
        out_months.append(r)

    os.makedirs(D, exist_ok=True)
    with open(os.path.join(D, "flows.json"), "w") as f:
        json.dump({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "method": "Voyages from Venezuelan crude terminals to U.S. refining ports by large tankers (Global Fishing "
                             "Watch port visits + API16 AIS). Volumes are estimates (+-20%) from draught or typical loads, "
                             "checked each month against EIA and U.S. customs.",
                   "attribution": "Port visits: Powered by Global Fishing Watch.",
                   "months": out_months, "voyages": voyages}, f, indent=1, ensure_ascii=False)
    hi = [x for x in voyages if x["confidence"] == "high"]
    print(f"flows: {len(hi)} high-confidence crude voyages, {len(voyages) - len(hi)} possible")


if __name__ == "__main__":
    main()
