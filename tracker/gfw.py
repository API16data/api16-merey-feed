"""API16 Global Fishing Watch collector: tanker port visits at Venezuelan oil terminals.

Free terrestrial AIS barely reaches Venezuelan terminals. Global Fishing Watch (GFW) combines
satellite and terrestrial AIS and publishes port-visit events for all vessel types, about four
days behind real time. This script asks GFW for:
  1. port visits inside the Venezuelan terminal areas (and the ABC islands) in the last 90 days;
  2. for every non-fishing vessel found there, and for every ship on the watchlist, its port
     visits in the last 90 days, so a Venezuela -> U.S. voyage can be followed port to port.

Needs the secret GFW_API_TOKEN (personal, non-commercial; never printed).
Data: Global Fishing Watch, CC BY-NC 4.0. Attribution: "Powered by Global Fishing Watch."
Output: tracker/data/gfw_port_visits.json
"""
import http.client, json, os, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

TOKEN = os.environ.get("GFW_API_TOKEN", "").strip()
BASE = "https://gateway.api.globalfishingwatch.org/v3"
DS_PORT = "public-global-port-visits-events:latest"
DS_ID = "public-global-vessel-identity:latest"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "gfw_port_visits.json")
WATCHLIST = os.path.join(HERE, "watchlist.json")

# [[lat_min, lon_min], [lat_max, lon_max]], same boxes as the AIS tracker
AREAS = {
    "Jose / Puerto La Cruz": [[9.90, -65.20], [10.45, -64.45]],
    "Paraguana: Amuay / Cardon": [[11.40, -70.40], [12.10, -69.80]],
    "Lake Maracaibo / Bajo Grande": [[10.30, -71.95], [11.30, -71.20]],
    "El Palito / Puerto Cabello": [[10.40, -68.30], [10.70, -67.80]],
    "Aruba / Curacao / Bonaire": [[12.00, -70.20], [12.70, -68.20]],
}
SKIP_TYPES = {"fishing", "passenger", "gear", "seismic_vessel"}
# Look-back window. The daily run uses 90 days; a one-off backfill (workflow input) can ask for more,
# e.g. since 1 Jan 2026. flows.py keeps older voyages, so the history builds up over time.
DAYS = max(30, int(os.environ.get("GFW_DAYS") or 90))
CAP = 2000 if DAYS <= 120 else 40000
log = []


def call(method, path, params=None, body=None, tries=3):
    url = BASE + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "API16-gfw/0.1"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:300]
            log.append(f"{method} {path}: HTTP {e.code} {msg}")
            if e.code in (400, 401, 403, 404, 422):
                return None
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException, ValueError) as e:
            # GFW sometimes cuts a long response mid-stream (IncompleteRead): retry the same page
            log.append(f"{method} {path}: {type(e).__name__}")
        time.sleep(10 * (i + 1))
    return None


def num(x):
    """GFW numbers come plain or wrapped ({"value": ...} or a list of those)."""
    if isinstance(x, list):
        x = x[0] if x else None
    if isinstance(x, dict):
        x = x.get("value")
    return x if isinstance(x, (int, float)) and x > 0 else None


def poly(box):
    (a, b), (c, d) = box
    return {"type": "Polygon", "coordinates": [[[b, a], [d, a], [d, c], [b, c], [b, a]]]}


def entries_of(res):
    return (res or {}).get("entries") or []


def page(method, path, params=None, body=None, cap=2000):
    out, offset = [], 0
    while True:
        p = dict(params or {}, limit=50, offset=offset)
        res = call(method, path, p, body)
        ents = entries_of(res)
        out += ents
        nxt = (res or {}).get("nextOffset")
        if not ents or nxt is None or nxt <= offset or len(out) >= cap:
            return out
        offset = nxt


def simplify(e, area=None):
    v = e.get("vessel") or {}
    pv = e.get("port_visit") or e.get("portVisit") or {}
    anc = pv.get("intermediateAnchorage") or pv.get("startAnchorage") or {}
    pos = e.get("position") or {}
    return {"vessel_id": v.get("id"), "name": v.get("name"), "mmsi": v.get("ssvid"), "flag": v.get("flag"),
            "type": v.get("type"), "start": e.get("start"), "end": e.get("end"),
            "hours": pv.get("durationHrs"), "confidence": pv.get("confidence"),
            "port": anc.get("name") or anc.get("topDestination"), "port_flag": anc.get("flag"),
            "at_dock": anc.get("atDock"), "lat": pos.get("lat"), "lon": pos.get("lon"), "area": area}


def main():
    if not TOKEN:
        raise SystemExit("Set GFW_API_TOKEN")
    now = datetime.now(timezone.utc)
    d = lambda days: (now - timedelta(days=days)).strftime("%Y-%m-%d")
    today = now.strftime("%Y-%m-%d")

    # 1. port visits inside the Venezuelan terminal areas
    ve_visits = []
    for area, box in AREAS.items():
        body = {"datasets": [DS_PORT], "startDate": d(DAYS), "endDate": today, "geometry": poly(box)}
        got = page("POST", "/events", body=body, cap=CAP)
        print(f"gfw: {area}: {len(got)} port visits")
        for e in got:
            s = simplify(e, area)
            if (s["type"] or "").lower() not in SKIP_TYPES:
                ve_visits.append(s)

    # 2. watchlist ships: find their GFW vessel ids by IMO / MMSI
    watch = []
    try:
        watch = json.load(open(WATCHLIST)).get("vessels", [])
    except (OSError, ValueError):
        pass
    ids = {s["vessel_id"]: s["name"] for s in ve_visits if s["vessel_id"]}
    for w in watch:
        for q in [w.get("imo"), w.get("mmsi")]:
            if not q:
                continue
            res = call("GET", "/vessels/search", {"query": str(q), "datasets[0]": DS_ID})
            found = False
            for ent in entries_of(res):
                for sr in ent.get("selfReportedInfo") or []:
                    if sr.get("id") and str(sr.get("ssvid")) == str(w.get("mmsi")):
                        ids[sr["id"]] = w.get("name"); found = True
            if found:
                break

    # 3. every port visit of those vessels in the last 90 days (all ports)
    voyages = {}
    id_list = list(ids)
    for i in range(0, len(id_list), 20):
        params = {"datasets[0]": DS_PORT, "start-date": d(DAYS + 30), "end-date": today}
        for j, vid in enumerate(id_list[i:i + 20]):
            params[f"vessels[{j}]"] = vid
        for e in page("GET", "/events", params, cap=CAP):
            s = simplify(e)
            voyages.setdefault(s["vessel_id"], []).append(s)
    for vid, lst in voyages.items():
        lst.sort(key=lambda x: x["start"] or "")

    # 4. Venezuela -> next port: for each VE/ABC visit, the next visit outside VE
    legs = []
    for vid, lst in voyages.items():
        for k, x in enumerate(lst):
            if (x["port_flag"] or "") not in ("VEN", "ABW", "CUW", "BES"):
                continue
            nxt = next((y for y in lst[k + 1:] if (y["port_flag"] or "") not in ("VEN", "ABW", "CUW", "BES")), None)
            if nxt:
                legs.append({"vessel_id": vid, "name": x["name"], "mmsi": x["mmsi"], "from_port": x["port"],
                             "from_flag": x["port_flag"], "left": x["end"], "to_port": nxt["port"],
                             "to_flag": nxt["port_flag"], "arrived": nxt["start"], "to_end": nxt["end"]})
    to_us = [l for l in legs if l["to_flag"] == "USA"]
    # One leg per U.S. arrival (the last Venezuelan/ABC departure before it). GFW labels tankers
    # "other_non_fishing" and container, cruise and general-cargo ships "cargo", so the first
    # group is kept as the likely-tanker list.
    vtype = {}
    for x in ve_visits + [y for lst in voyages.values() for y in lst]:
        if x["vessel_id"] and x["type"]:
            vtype.setdefault(x["vessel_id"], x["type"])
    best = {}
    for l in to_us:
        k = (l["vessel_id"], l["arrived"])
        if k not in best or (l["left"] or "") > (best[k]["left"] or ""):
            best[k] = dict(l, type=vtype.get(l["vessel_id"]))
    tanker_legs = sorted((l for l in best.values() if l["type"] == "other_non_fishing"),
                         key=lambda x: x["arrived"] or "", reverse=True)

    # 5. identity of the likely tankers: size, tonnage and ship type from registries + AIS
    ident, sample = {}, None
    for vid in sorted({l["vessel_id"] for l in tanker_legs if l["vessel_id"]}):
        res = call("GET", f"/vessels/{vid}", {"dataset": DS_ID})
        if not res:
            continue
        sample = sample or {k: (list(v[0].keys()) if isinstance(v, list) and v and isinstance(v[0], dict) else type(v).__name__)
                            for k, v in res.items()}
        reg = (res.get("registryInfo") or [{}])[0] if res.get("registryInfo") else {}
        sr = (res.get("selfReportedInfo") or [{}])[0] if res.get("selfReportedInfo") else {}
        cs = (res.get("combinedSourcesInfo") or [{}])[0] if res.get("combinedSourcesInfo") else {}
        ident[vid] = {"imo": reg.get("imo") or sr.get("imo"), "length_m": num(reg.get("lengthM")) or num(cs.get("bestLengthM")),
                      "gt": num(reg.get("tonnageGt")) or num(cs.get("bestTonnageGt")),
                      "registry_shiptypes": reg.get("shiptypes"), "built": reg.get("builtYear"),
                      "shiptypes": [t.get("name") for t in (cs.get("shiptypes") or []) if isinstance(t, dict)],
                      "geartypes": [t.get("name") for t in (cs.get("geartypes") or []) if isinstance(t, dict)]}
    for l in tanker_legs:
        l["identity"] = ident.get(l["vessel_id"])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
               "attribution": "Powered by Global Fishing Watch (globalfishingwatch.org). CC BY-NC 4.0.",
               "method": "GFW port-visit events (satellite + terrestrial AIS, about 4 days behind real time). "
                         "Visits inside Venezuelan terminal areas in the last 90 days; full port history (90 days) "
                         "for those vessels and for API16's watchlist.",
               "ve_visits": sorted(ve_visits, key=lambda x: x["start"] or "", reverse=True),
               "tanker_legs_to_us": tanker_legs,
               "legs_to_us": sorted(best.values(), key=lambda x: x["arrived"] or "", reverse=True),
               "legs_all": sorted(legs, key=lambda x: x["arrived"] or "", reverse=True)[:200],
               "vessels_followed": len(ids), "identity_fields": sample, "log": log[-30:]}, open(OUT, "w"), indent=1, ensure_ascii=False)
    print(f"gfw: {len(ve_visits)} visits in VE/ABC areas, {len(ids)} vessels followed, {len(best)} legs to the U.S., "
          f"{len(tanker_legs)} by likely tankers")
    for line in log[-10:]:
        print("gfw note:", line)


if __name__ == "__main__":
    main()
