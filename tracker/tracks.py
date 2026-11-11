"""API16 real routes: daily satellite positions, ship-to-ship encounters and AIS gaps for each voyage.

For every Venezuela -> U.S. voyage in tracker/data/flows.json (last DAYS days), asks Global Fishing
Watch for:
  1. the vessel's AIS presence between departure and arrival (4Wings report, daily cells), reduced to
     one position per day (hours-weighted centre of the cells it crossed that day);
  2. encounters (possible ship-to-ship transfers), loitering and AIS-off gaps during the voyage.
The home map uses these to draw the real route instead of a typical one, and to flag transfers and
gaps. Voyages already done are kept (cache), so each daily run only asks for new ones.

Needs the secret GFW_API_TOKEN (personal, non-commercial; never printed).
Data: Global Fishing Watch, CC BY-NC 4.0. Attribution: "Powered by Global Fishing Watch."
Output: tracker/data/tracks.json
"""
import http.client, json, os, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

TOKEN = os.environ.get("GFW_API_TOKEN", "").strip()
BASE = "https://gateway.api.globalfishingwatch.org/v3"
DS_PRESENCE = "public-global-presence:latest"
DS_EVENTS = ["public-global-encounters-events:latest", "public-global-loitering-events:latest", "public-global-gaps-events:latest"]
HERE = os.path.dirname(os.path.abspath(__file__))
FLOWS = os.path.join(HERE, "data", "flows.json")
OUT = os.path.join(HERE, "data", "tracks.json")
DAYS = int(os.environ.get("TRACK_DAYS") or 80)
MAX_NEW = int(os.environ.get("TRACK_MAX") or 60)         # new voyages per run (one report at a time)
# Caribbean, Gulf of Mexico and the U.S. East Coast approaches
AREA = {"type": "Polygon", "coordinates": [[[-100, 7], [-58, 7], [-58, 41], [-100, 41], [-100, 7]]]}
log = []


def call(method, path, params=None, body=None, tries=4):
    url = BASE + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "API16-tracks/0.1"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:300]
            log.append(f"{method} {path}: HTTP {e.code} {msg}")
            if e.code in (400, 401, 403, 404, 422):
                return None
            time.sleep(30 if e.code in (429, 524) else 10 * (i + 1))
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException, ValueError) as e:
            log.append(f"{method} {path}: {type(e).__name__}")
            time.sleep(10 * (i + 1))
    return None


def rows_of(res):
    """4Wings JSON: {"entries": [{"<dataset:version>": [rows...]}]}"""
    out = []
    for ent in (res or {}).get("entries") or []:
        if isinstance(ent, dict):
            for v in ent.values():
                if isinstance(v, list):
                    out += v
    return out


def daily_track(vid, dep, arr):
    params = {"format": "JSON", "datasets[0]": DS_PRESENCE, "temporal-resolution": "DAILY",
              "spatial-resolution": "HIGH", "date-range": dep + "," + arr,
              "filters[0]": f"vessel_id in ('{vid}')"}
    res = call("POST", "/4wings/report", params, {"geojson": AREA})
    rows = rows_of(res)
    days = {}
    for r in rows:
        lat, lon, d = r.get("lat"), r.get("lon"), str(r.get("date") or "")[:10]
        h = r.get("hours") or 1
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or len(d) < 10:
            continue
        a = days.setdefault(d, [0.0, 0.0, 0.0])
        a[0] += lat * h; a[1] += lon * h; a[2] += h
    pts = [[d, round(a[0] / a[2], 3), round(a[1] / a[2], 3)] for d, a in sorted(days.items()) if a[2]]
    return pts, (res is not None), len(rows)


def simplify_event(e):
    pos = e.get("position") or {}
    v = e.get("vessel") or {}
    t = (e.get("type") or "").lower()
    out = {"type": t, "start": e.get("start"), "end": e.get("end"), "lat": pos.get("lat"), "lon": pos.get("lon"),
           "vessel_id": v.get("id"), "name": v.get("name")}
    enc = e.get("encounter") or {}
    if enc:
        other = enc.get("vessel") or enc.get("encounteredVessel") or {}
        out.update({"other_name": other.get("name"), "other_id": other.get("id"), "other_type": other.get("type"),
                    "hours": enc.get("durationHrs") or enc.get("duration_hrs")})
    gap = e.get("gap") or {}
    if gap:
        out.update({"hours": gap.get("durationHours") or gap.get("durationHrs"), "km": gap.get("distanceKm"),
                    "keys": sorted(gap.keys())[:12]})
    loi = e.get("loitering") or {}
    if loi:
        out.update({"hours": loi.get("totalTimeHours") or loi.get("durationHrs")})
    return out


def main():
    if not TOKEN:
        raise SystemExit("Set GFW_API_TOKEN")
    now = datetime.now(timezone.utc)
    F = json.load(open(FLOWS))
    prev = {}
    try:
        prev = json.load(open(OUT))
    except (OSError, ValueError):
        pass
    tracks = prev.get("tracks") or {}
    since = (now - timedelta(days=DAYS)).strftime("%Y-%m-%d")
    todo = [v for v in F.get("voyages", []) if v.get("vessel_id") and (v.get("arrived") or "") >= since]
    print(f"tracks: {len(todo)} voyages with a GFW vessel id in the last {DAYS} days, {len(tracks)} cached")

    # 1. daily positions per voyage (cached by mmsi + arrival day)
    new = 0
    for v in todo:
        key = f"{v.get('mmsi')}|{(v.get('arrived') or '')[:10]}"
        if key in tracks or new >= MAX_NEW:
            continue
        arr = (v.get("arrived") or "")[:10]
        dep = (v.get("left") or "")[:10] or (datetime.fromisoformat(arr) - timedelta(days=8)).strftime("%Y-%m-%d")
        end = (datetime.fromisoformat(arr) + timedelta(days=1)).strftime("%Y-%m-%d")
        pts, ok, n = daily_track(v["vessel_id"], dep, end)
        new += 1
        if ok:
            tracks[key] = pts
        print(f"tracks: {v.get('name')} {dep}..{arr}: {len(pts)} days from {n} cells")
        time.sleep(1)

    # 2. encounters, loitering and AIS gaps for those vessels during the window
    events = []
    ids = sorted({v["vessel_id"] for v in todo})
    for i in range(0, len(ids), 20):
        for ds in DS_EVENTS:
            params = {"datasets[0]": ds, "start-date": since, "end-date": now.strftime("%Y-%m-%d"), "limit": 200, "offset": 0}
            for j, vid in enumerate(ids[i:i + 20]):
                params[f"vessels[{j}]"] = vid
            res = call("GET", "/events", params)
            for e in (res or {}).get("entries") or []:
                events.append(simplify_event(e))
    events.sort(key=lambda x: x.get("start") or "")
    sample = {}
    for e in events:
        sample.setdefault(e["type"], e)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    keep = {k: p for k, p in tracks.items() if k.split("|")[1] >= (now - timedelta(days=400)).strftime("%Y-%m-%d")}
    json.dump({"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
               "attribution": "Powered by Global Fishing Watch (globalfishingwatch.org). CC BY-NC 4.0.",
               "method": "Daily AIS presence (satellite + terrestrial) per voyage, reduced to one hours-weighted position "
                         "per day; encounters, loitering and AIS-off gap events for the same vessels.",
               "tracks": keep, "events": events, "event_samples": sample, "log": log[-30:]},
              open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"tracks: {sum(1 for p in keep.values() if p)} voyages with a real track, {len(events)} events "
          f"({', '.join(sorted({e['type'] for e in events}))})")
    for line in log[-10:]:
        print("tracks note:", line)


if __name__ == "__main__":
    main()
