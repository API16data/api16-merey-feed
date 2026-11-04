"""API16 Global Fishing Watch collector: tanker port visits at Venezuelan oil terminals.

Free terrestrial AIS barely reaches Venezuelan terminals. Global Fishing Watch (GFW) combines
satellite and terrestrial AIS and publishes port-visit events for all vessel types, about four
days behind real time. This script asks GFW for:
  1. port visits inside the Venezuelan terminal areas (and the ABC islands) in the last 45 days;
  2. for every non-fishing vessel found there, and for every ship on the watchlist, its port
     visits in the last 90 days, so a Venezuela -> U.S. voyage can be followed port to port.

Needs the secret GFW_API_TOKEN (personal, non-commercial; never printed).
Data: Global Fishing Watch, CC BY-NC 4.0. Attribution: "Powered by Global Fishing Watch."
Output: tracker/data/gfw_port_visits.json
"""
import json, os, time, urllib.error, urllib.parse, urllib.request
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
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            log.append(f"{method} {path}: {type(e).__name__}")
        time.sleep(10 * (i + 1))
    return None


def poly(box):
    (a, b), (c, d) = box
    return {"type": "Polygon", "coordinates": [[[b, a], [d, a], [d, c], [b, c], [b, a]]]}


def entries_of(res):
    return (res or {}).get("entries") or []


def page(method, path, params=None, body=None, cap=2000):
    out, offset = [], 0
    while True:
        p = dict(params or {}, limit=200, offset=offset)
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
        body = {"datasets": [DS_PORT], "startDate": d(45), "endDate": today, "geometry": poly(box)}
        for e in page("POST", "/events", body=body):
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
        params = {"datasets[0]": DS_PORT, "start-date": d(90), "end-date": today}
        for j, vid in enumerate(id_list[i:i + 20]):
            params[f"vessels[{j}]"] = vid
        for e in page("GET", "/events", params):
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

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
               "attribution": "Powered by Global Fishing Watch (globalfishingwatch.org). CC BY-NC 4.0.",
               "method": "GFW port-visit events (satellite + terrestrial AIS, about 4 days behind real time). "
                         "Visits inside Venezuelan terminal areas in the last 45 days; full port history (90 days) "
                         "for those vessels and for API16's watchlist.",
               "ve_visits": sorted(ve_visits, key=lambda x: x["start"] or "", reverse=True),
               "legs_to_us": sorted(to_us, key=lambda x: x["arrived"] or "", reverse=True),
               "legs_all": sorted(legs, key=lambda x: x["arrived"] or "", reverse=True)[:200],
               "vessels_followed": len(ids), "log": log[-30:]}, open(OUT, "w"), indent=1, ensure_ascii=False)
    print(f"gfw: {len(ve_visits)} visits in VE/ABC areas, {len(ids)} vessels followed, {len(to_us)} legs to the U.S.")
    for line in log[-10:]:
        print("gfw note:", line)


if __name__ == "__main__":
    main()
