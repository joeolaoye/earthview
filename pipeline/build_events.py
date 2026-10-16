"""Merge raw fetches into web/public/data/events.json + population.json (compact arrays).

Event array format: [year, lat, lon, catIdx, title, mag(0..1), srcUrl]
Years are astronomical (1 CE = 1, 1 BCE = 0, 1468 BCE = -1467).
"""
import math
import os

from fetch_common import RAW, load_json

WEB_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "data")

CATS = [
    {"key": "war", "label": "Wars & battles", "color": "#ef4444"},
    {"key": "famine", "label": "Famines", "color": "#f59e0b"},
    {"key": "eclipse", "label": "Eclipses", "color": "#a78bfa"},
    {"key": "earthquake", "label": "Earthquakes", "color": "#e879f9"},
    {"key": "tsunami", "label": "Tsunamis", "color": "#38bdf8"},
    {"key": "volcano", "label": "Volcanic eruptions", "color": "#fb923c"},
]
IDX = {c["key"]: i for i, c in enumerate(CATS)}

MIN_YEAR, MAX_YEAR = -1467, 2026
MIN_DISPLAY, MAX_DISPLAY = 1e12, -1e12


def deaths_mag(deaths):
    if deaths is None or deaths <= 0:
        return None
    return max(0.05, min(1.0, math.log10(1 + deaths) / 6.0))


def add(events, cat, year, lat, lon, title, mag, src):
    if year is None or lat is None or lon is None:
        return 0
    if not (MIN_YEAR <= year <= MAX_YEAR):
        return 0
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return 0
    if mag is None:
        mag = 0.4
    mag = max(0.05, min(1.0, float(mag)))
    events.append([round(float(year), 1), round(float(lat), 3), round(float(lon), 3),
                   IDX[cat], str(title)[:120], round(mag, 3), src])
    return 1


def main():
    events = []
    counts = {}

    # wars: wikidata battles (+ HiCED if present)
    n = 0
    for b in load_json("wikidata_battles.json", default=[]):
        n += add(events, "war", b["year"], b["lat"], b["lon"], b["title"],
                 deaths_mag(b.get("deaths")),
                 f"https://www.wikidata.org/wiki/{b['qid']}")
    counts["war/wikidata"] = n
    n = 0
    for b in load_json("hiced.json", default=[]):
        n += add(events, "war", b["year"], b["lat"], b["lon"], b["title"],
                 deaths_mag(b.get("deaths")),
                 "https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/6ZFC0V")
    counts["war/hiced"] = n

    # famines
    n = 0
    for f in load_json("famines.json", default=[]):
        n += add(events, "famine", f["year"], f["lat"], f["lon"], f["title"],
                 deaths_mag(f.get("deaths")), "https://ourworldindata.org/famines")
    counts["famine"] = n

    # eclipses
    n = 0
    type_mag = {"T": 0.45, "H": 0.5, "A": 0.3}
    for e in load_json("eclipses.json", default=[]):
        t = e.get("type", "A").rstrip("+")
        n += add(events, "eclipse", e["year"], e["lat"], e["lon"],
                 f"{'Total' if t == 'T' else 'Hybrid' if t == 'H' else 'Annular'} solar eclipse",
                 type_mag.get(t, 0.3), e.get("src", "https://eclipse.gsfc.nasa.gov/SEcat5/SEcatalog.html"))
    counts["eclipse"] = n

    # hazards: quakes/tsunamis/volcanoes from USGS (1900+), curated pre-1900 sets,
    # plus NCEI files if a future run of fetch_ncei.py produces them
    def sig_from_mag(m):
        if m is None:
            return None
        try:
            return max(0.05, min(1.0, (float(m) - 5.0) / 4.0))
        except (TypeError, ValueError):
            return None

    def load_multi(*names):
        out = []
        for name in names:
            out.extend(load_json(name, default=[]))
        return out

    n = 0
    for r in load_multi("ncei_earthquakes.json", "usgs_earthquakes.json"):
        mag = sig_from_mag(r.get("mag")) or deaths_mag(r.get("deaths"))
        n += add(events, "earthquake", r["year"], r["lat"], r["lon"],
                 r["title"], mag, r.get("src") or "https://earthquake.usgs.gov/fdsnws/event/1/")
    counts["earthquake"] = n

    n = 0
    for r in load_multi("ncei_tsunamis.json", "usgs_tsunamis.json", "curated_tsunamis.json"):
        mag = sig_from_mag(r.get("mag")) or deaths_mag(r.get("deaths")) or 0.5
        n += add(events, "tsunami", r["year"], r["lat"], r["lon"], r["title"], mag,
                 r.get("src") or "https://www.ngdc.noaa.gov/hazel/view/hazards/tsunami/event-search")
    counts["tsunami"] = n

    n = 0
    for r in load_multi("ncei_volcanoes.json", "curated_volcanoes.json"):
        mag = r.get("mag") or deaths_mag(r.get("deaths"))
        n += add(events, "volcano", r["year"], r["lat"], r["lon"], r["title"], mag,
                 r.get("src") or "https://volcano.si.edu/")
    counts["volcano"] = n

    # dedupe identical [year,lat,lon,cat,title]
    seen = set()
    deduped = []
    for e in events:
        k = (e[0], e[1], e[2], e[3], e[4])
        if k in seen:
            continue
        seen.add(k)
        deduped.append(e)
    deduped.sort(key=lambda e: e[0])

    os.makedirs(WEB_DATA, exist_ok=True)
    out = {
        "minYear": MIN_YEAR,
        "maxYear": MAX_YEAR,
        "categories": CATS,
        "events": deduped,
        "counts": counts,
    }
    import json

    with open(os.path.join(WEB_DATA, "events.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    yrs = [e[0] for e in deduped]
    print(json.dumps(counts, indent=1))
    print(f"TOTAL events: {len(deduped)} (deduped from {len(events)}), "
          f"years {min(yrs)} .. {max(yrs)}")
    size = os.path.getsize(os.path.join(WEB_DATA, "events.json"))
    print(f"events.json size: {size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
