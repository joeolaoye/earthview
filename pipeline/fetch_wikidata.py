"""Fetch battles (with coordinates, dates, optional death tolls) from Wikidata SPARQL. CC0."""
import json
import re
import urllib.parse

from fetch_common import http_get, save_json

QUERY = """
SELECT ?b ?bLabel ?date ?coord ?deaths WHERE {
  ?b wdt:P31 wd:Q178561 .
  ?b wdt:P585 ?date .
  ?b wdt:P625 ?coord .
  OPTIONAL { ?b wdt:P1120 ?deaths . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""

YEAR_RE = re.compile(r"^(-?\d{1,5})")
COORD_RE = re.compile(r"Point\(([-\d.]+) ([-\d.]+)\)")


def main():
    url = (
        "https://query.wikidata.org/sparql?format=json&query="
        + urllib.parse.quote(QUERY)
    )
    print("querying wikidata sparql (may take ~60s)...")
    raw = http_get(url, headers={"Accept": "application/sparql-results+json"}, timeout=180)
    data = json.loads(raw)
    rows = []
    seen = set()
    dropped_bad = 0
    for b in data["results"]["bindings"]:
        qid = b["b"]["value"].rsplit("/", 1)[-1]
        if qid in seen:
            continue
        m = YEAR_RE.match(b["date"]["value"])
        if not m:
            dropped_bad += 1
            continue
        year = int(m.group(1))
        c = COORD_RE.search(b["coord"]["value"])
        if not c:
            dropped_bad += 1
            continue
        lon, lat = float(c.group(1)), float(c.group(2))
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            dropped_bad += 1
            continue
        deaths = None
        if "deaths" in b:
            try:
                deaths = float(b["deaths"]["value"])
            except ValueError:
                pass
        title = b.get("bLabel", {}).get("value", qid)
        if title == qid:  # unlabeled — skip to keep the globe readable
            dropped_bad += 1
            continue
        seen.add(qid)
        rows.append({"qid": qid, "title": title, "year": year, "lat": lat, "lon": lon, "deaths": deaths})
    print(f"battles: {len(rows)} kept, {dropped_bad} dropped (no label/date/coord)")
    save_json("wikidata_battles.json", rows)


if __name__ == "__main__":
    main()
