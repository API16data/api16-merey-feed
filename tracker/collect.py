"""API16 Tracker — collects AIS tanker positions around Venezuela, the Caribbean
and the US Gulf Coast, and keeps a public log of tankers linked to Venezuela.

Runs on a schedule (GitHub Actions). Needs the env var AISSTREAM_API_KEY.
Free AIS (aisstream.io) comes from land-based receivers: coverage near the
Venezuelan terminals is thin, coverage in the US Gulf is good. Every link to
Venezuela below is a PROBABLE link from public AIS, not a confirmed cargo.

Outputs (in tracker/data/):
  latest.json        tankers seen in the last run, with zone and status
  vessels.json       registry of every tanker seen, with the zones it passed
  venezuela.json     tankers linked to Venezuela, and which of them later
                     reached a US Gulf port
  runs.jsonl         one line per run (counts), for the history chart
  ship_types.json    AIS ship type per MMSI learned so far (to spot tankers sooner)
"""
import asyncio, json, os, re, sys, time
from datetime import datetime, timezone

import websockets

KEY = os.environ.get("AISSTREAM_API_KEY", "").strip()
SECONDS = int(os.environ.get("LISTEN_SECONDS", sys.argv[1] if len(sys.argv) > 1 else "600"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# What we subscribe to: [[lat_min, lon_min], [lat_max, lon_max]]
LISTEN = [
    [[9.5, -72.5], [13.2, -60.0]],   # Venezuelan coast + Aruba/Curacao/Bonaire + Trinidad
    [[27.4, -97.6], [30.4, -88.3]],  # US Gulf Coast: Corpus Christi to Pascagoula
]

# Named zones, checked in order (first match wins). group: VE = Venezuela, ABC = islands, USG = US Gulf
ZONES = [
    ("VE", "Jose / Puerto La Cruz", [[9.90, -65.20], [10.45, -64.45]]),
    ("VE", "Paraguana: Amuay / Cardon", [[11.40, -70.40], [12.10, -69.80]]),
    ("VE", "Lake Maracaibo / Bajo Grande", [[10.30, -71.95], [11.30, -71.20]]),
    ("VE", "El Palito / Puerto Cabello", [[10.40, -68.30], [10.70, -67.80]]),
    ("ABC", "Aruba / Curacao / Bonaire", [[12.00, -70.20], [12.70, -68.20]]),
    ("USG", "Corpus Christi", [[27.50, -97.60], [28.00, -96.90]]),
    ("USG", "Houston / Galveston / Texas City", [[29.20, -95.40], [29.90, -94.50]]),
    ("USG", "Freeport", [[28.80, -95.50], [29.05, -95.20]]),
    ("USG", "Port Arthur / Beaumont / Sabine", [[29.55, -94.20], [30.15, -93.70]]),
    ("USG", "Lake Charles", [[29.70, -93.45], [30.30, -93.10]]),
    ("USG", "Mississippi River / New Orleans", [[28.90, -90.50], [30.10, -89.30]]),
    ("USG", "Pascagoula", [[30.10, -88.70], [30.40, -88.40]]),
    ("USG", "Gulf of Mexico offshore (lightering)", [[27.40, -95.80], [29.20, -88.30]]),
    ("VE", "Venezuelan waters (other)", [[9.50, -72.50], [12.30, -60.00]]),
]

VE_DEST = re.compile(
    r"\b(VE|VEN|VENEZUELA|JOSE|PTO\s*JOSE|JOSE\s*TERM|AMUAY|CARDON|PUNTA\s*CARDON|PUERTO\s*LA\s*CRUZ|PLC|"
    r"GUARAGUAO|BAJO\s*GRANDE|MARACAIBO|LA\s*SALINA|CABIMAS|EL\s*PALITO|PUERTO\s*CABELLO|VE\s*[A-Z]{3})\b"
)
NAV = {0: "under way", 1: "at anchor", 2: "not under command", 3: "restricted", 5: "moored", 15: "not defined"}


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def zone_of(lat, lon):
    for group, name, ((a, b), (c, d)) in ZONES:
        if a <= lat <= c and b <= lon <= d:
            return group, name
    return None, "Open sea / other"


def load(name, default):
    try:
        with open(os.path.join(OUT, name)) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save(name, obj):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(obj, f, indent=1, sort_keys=False)


async def listen():
    pos, static, msgs = {}, {}, 0
    sub = {"APIKey": KEY, "BoundingBoxes": LISTEN, "FilterMessageTypes": ["PositionReport", "ShipStaticData"]}
    end = time.time() + SECONDS
    async with websockets.connect("wss://stream.aisstream.io/v0/stream", open_timeout=30, max_size=2**22) as ws:
        await ws.send(json.dumps(sub))
        while time.time() < end:
            try:
                m = json.loads(await asyncio.wait_for(ws.recv(), timeout=max(1, end - time.time())))
            except asyncio.TimeoutError:
                break
            if "error" in m:
                raise SystemExit(f"AISStream error: {m['error']}")
            mt, md = m.get("MessageType"), m.get("MetaData", {})
            if mt == "PositionReport":
                p = m["Message"]["PositionReport"]
                pos[md["MMSI"]] = dict(name=(md.get("ShipName") or "").strip(), lat=round(p["Latitude"], 4),
                                       lon=round(p["Longitude"], 4), speed_kn=p.get("Sog"),
                                       status=NAV.get(p.get("NavigationalStatus"), "other"),
                                       time=(md.get("time_utc") or "")[:19].replace(" ", "T") + "Z")
                msgs += 1
            elif mt == "ShipStaticData":
                d = m["Message"]["ShipStaticData"]
                dim = d.get("Dimension") or {}
                static[md["MMSI"]] = dict(imo=d.get("ImoNumber") or None, type=d.get("Type"),
                                          destination=(d.get("Destination") or "").strip().upper(),
                                          draught_m=d.get("MaximumStaticDraught"),
                                          length_m=(dim.get("A") or 0) + (dim.get("B") or 0),
                                          name=(d.get("Name") or "").strip())
                msgs += 1
    return pos, static, msgs


def main():
    if not KEY:
        raise SystemExit("Set AISSTREAM_API_KEY")
    os.makedirs(OUT, exist_ok=True)
    run_at = now_iso()
    pos, static, msgs = asyncio.run(listen())
    vessels = load("vessels.json", {})
    # Ship types arrive only every ~6 minutes per ship, so we remember every type we learn
    # (all ships, not only tankers) and reuse it in later runs.
    types = load("ship_types.json", {})
    for mmsi, s in static.items():
        if s.get("type") is not None:
            types[str(mmsi)] = s["type"]

    def is_tanker(mmsi):
        t = (static.get(mmsi) or {}).get("type")
        if t is None:
            t = types.get(str(mmsi))
        return t is not None and 80 <= t <= 89

    latest = []
    for mmsi, p in pos.items():
        if not is_tanker(mmsi):
            continue
        s = static.get(mmsi, {})
        v = vessels.setdefault(str(mmsi), {"mmsi": mmsi, "first_seen": run_at, "visits": []})
        for k in ("imo", "type", "length_m"):
            if s.get(k):
                v[k] = s[k]
        v["name"] = s.get("name") or p["name"] or v.get("name", "")
        if s.get("destination"):
            v["destination"] = s["destination"]
        if s.get("draught_m"):
            v["draught_m"] = s["draught_m"]
        group, zone = zone_of(p["lat"], p["lon"])
        v["last_seen"] = run_at
        v["last_zone"], v["last_group"] = zone, group
        last = v["visits"][-1] if v["visits"] else None
        if last and last["zone"] == zone:
            last["last"] = run_at
            if v.get("draught_m"):
                last["draught_m"] = v["draught_m"]
        else:
            v["visits"].append({"zone": zone, "group": group, "first": run_at, "last": run_at, "draught_m": v.get("draught_m")})
            v["visits"] = v["visits"][-30:]
        if group == "VE" or group == "ABC":
            v["seen_near_venezuela"] = True
        if VE_DEST.search(v.get("destination", "")):
            v["destination_venezuela"] = True
        latest.append({"mmsi": mmsi, "imo": v.get("imo"), "name": v["name"], "zone": zone, "group": group,
                       "status": p["status"], "speed_kn": p["speed_kn"], "draught_m": v.get("draught_m"),
                       "destination": v.get("destination", ""), "lat": p["lat"], "lon": p["lon"], "time": p["time"],
                       "venezuela_link": bool(v.get("seen_near_venezuela") or v.get("destination_venezuela"))})

    # tankers linked to Venezuela, and which then reached a US Gulf zone
    linked = []
    for v in vessels.values():
        if not (v.get("seen_near_venezuela") or v.get("destination_venezuela")):
            continue
        ve_times = [x["last"] for x in v["visits"] if x["group"] in ("VE", "ABC")]
        us_after = [x for x in v["visits"] if x["group"] == "USG" and ve_times and x["first"] > min(ve_times)]
        linked.append({
            "mmsi": v["mmsi"], "imo": v.get("imo"), "name": v.get("name"), "length_m": v.get("length_m"),
            "why": ("seen in Venezuelan / ABC waters" if v.get("seen_near_venezuela") else "")
                   + (" + " if v.get("seen_near_venezuela") and v.get("destination_venezuela") else "")
                   + ("AIS destination is a Venezuelan port" if v.get("destination_venezuela") else ""),
            "last_zone": v.get("last_zone"), "last_seen": v.get("last_seen"), "destination": v.get("destination", ""),
            "arrived_us_gulf": bool(us_after), "us_gulf_port": us_after[-1]["zone"] if us_after else None,
            "us_gulf_first_seen": us_after[-1]["first"] if us_after else None,
        })
    linked.sort(key=lambda x: x["last_seen"] or "", reverse=True)

    latest.sort(key=lambda x: (x["group"] or "Z", x["zone"], x["name"]))
    save("latest.json", {"run_at": run_at, "listen_seconds": SECONDS, "ais_messages": msgs, "tankers": latest})
    save("vessels.json", vessels)
    save("ship_types.json", types)
    save("venezuela.json", {"updated": run_at, "note": "Probable links from public AIS, not confirmed cargoes.", "tankers": linked})
    by_group = {}
    for t in latest:
        by_group[t["group"] or "OTHER"] = by_group.get(t["group"] or "OTHER", 0) + 1
    with open(os.path.join(OUT, "runs.jsonl"), "a") as f:
        f.write(json.dumps({"run_at": run_at, "listen_seconds": SECONDS, "ais_messages": msgs, "tankers_seen": len(latest),
                            "by_group": by_group, "venezuela_linked_total": len(linked),
                            "venezuela_linked_in_us_gulf": sum(1 for x in linked if x["arrived_us_gulf"])}) + "\n")
    print(f"{run_at}: {msgs} AIS msgs, {len(latest)} tankers seen {by_group}, {len(linked)} linked to Venezuela "
          f"({sum(1 for x in linked if x['arrived_us_gulf'])} later in US Gulf)")


if __name__ == "__main__":
    main()
