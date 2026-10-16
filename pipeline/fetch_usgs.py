"""USGS FDSN earthquake catalog (M5.5+, 1900->present), public domain, no key.

The `tsunami` flag column is used to derive a modern tsunami event set.
"""
import csv
import io

from fetch_common import http_get, save_json

URL = ("https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv"
       "&starttime=1900-01-01&endtime=2026-01-01&minmagnitude=6.0&orderby=time-asc")


def main():
    print("downloading USGS catalog (M5.5+, ~15k rows)...")
    txt = http_get(URL, timeout=300)
    rows = list(csv.DictReader(io.StringIO(txt)))
    print(f"rows: {len(rows)}; columns: {list(rows[0].keys())[:10]}...")
    quakes = []
    tsunamis = []
    for r in rows:
        try:
            year = int(r["time"][:4])
            lat = float(r["latitude"])
            lon = float(r["longitude"])
            mag = float(r["mag"])
        except (KeyError, TypeError, ValueError):
            continue
        place = (r.get("place") or "Earthquake").strip()
        title = f"{place} (M{mag:g})"
        rec = {"title": title, "year": year, "lat": lat, "lon": lon, "mag": mag}
        quakes.append(rec)
        if r.get("tsunami") == "1":
            tsunamis.append({"title": f"Tsunami — {place}", "year": year,
                             "lat": lat, "lon": lon, "mag": mag})
    print(f"earthquakes: {len(quakes)}; tsunami-flagged: {len(tsunamis)}")
    save_json("usgs_earthquakes.json", quakes)
    save_json("usgs_tsunamis.json", tsunamis)


if __name__ == "__main__":
    main()
