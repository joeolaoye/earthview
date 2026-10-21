"""Notable people: births + deaths with coordinates and a fame score, from Wikidata.

One chunked SPARQL query per time window (a single whole-corpus query times out).
Fame proxy = wikibase:sitelinks (number of Wikipedia language editions).
Output raw/people.json: [{qid, name, by, blat, blon, dy, dlat, dlon, sl}]
Years are astronomical (1 BCE = 0). CC0.
"""
import json
import re
import time
import urllib.parse

from fetch_common import http_get, save_json

ENDPOINT = "https://query.wikidata.org/sparql"
MIN_SL = 14  # fame threshold: >= 14 Wikipedia language editions
LIMIT = 5000

# (start, end) year windows — smaller where Wikidata is dense
WINDOWS = (
    [(-1500, -900), (-900, -500), (-500, -100), (-100, 1)]
    + [(y, y + 100) for y in range(1, 1700, 100)]
    + [(y, y + 50) for y in range(1700, 1900, 50)]
    + [(y, y + 25) for y in range(1900, 2026, 25)]
    + [(2026, 2027)]
)

PREFIXES = (
    "PREFIX wdt: <http://www.wikidata.org/prop/direct/>\n"
    "PREFIX wikbase: <http://wikiba.se/ontology#>\n"
    "PREFIX bd: <http://www.bigdata.com/rdf#>\n"
    "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n"
)

# label strategies: Wikidata runs two query backends; the label SERVICE 400s on
# one of them and the inline-label join is slower but universally accepted.
Q_LABEL_SERVICE = PREFIXES + """
SELECT ?p ?pLabel ?dob ?bcoord ?dod ?dcoord ?sl WHERE {{
  ?p wdt:P569 ?dob ; wdt:P19 ?pob . ?pob wdt:P625 ?bcoord .
  ?p wikbase:sitelinks ?sl .
  FILTER(?sl >= {sl} && YEAR(?dob) >= {y0} && YEAR(?dob) < {y1})
  OPTIONAL {{ ?p wdt:P570 ?dod }}
  OPTIONAL {{ ?p wdt:P20 ?pod . ?pod wdt:P625 ?dcoord }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}} LIMIT {limit}
"""

Q_INLINE_LABEL = PREFIXES + """
SELECT ?p ?pLabel ?dob ?bcoord ?dod ?dcoord ?sl WHERE {{
  ?p wdt:P569 ?dob ; wdt:P19 ?pob . ?pob wdt:P625 ?bcoord .
  ?p wikbase:sitelinks ?sl ; rdfs:label ?pLabel .
  FILTER(LANG(?pLabel) = "en" && ?sl >= {sl} && YEAR(?dob) >= {y0} && YEAR(?dob) < {y1})
  OPTIONAL {{ ?p wdt:P570 ?dod }}
  OPTIONAL {{ ?p wdt:P20 ?pod . ?pod wdt:P625 ?dcoord }}
}} LIMIT {limit}
"""

YEAR_RE = re.compile(r"^(-?\d{1,5})")
COORD_RE = re.compile(r"Point\(([-\d.]+) ([-\d.]+)\)")


def run_chunk(y0, y1, sl=MIN_SL, limit=LIMIT):
    """Try each query strategy (GET then POST) until one returns bindings."""
    import urllib.request

    last = None
    for tmpl in (Q_LABEL_SERVICE, Q_INLINE_LABEL):
        q = tmpl.format(sl=sl, y0=y0, y1=y1, limit=limit)
        for method in ("GET", "POST"):
            try:
                if method == "GET":
                    url = ENDPOINT + "?format=json&query=" + urllib.parse.quote(q)
                    raw = http_get(url, headers={"Accept": "application/sparql-results+json"}, timeout=45, retries=1)
                else:
                    data = urllib.parse.urlencode({"query": q, "format": "json"}).encode()
                    req = urllib.request.Request(ENDPOINT, data=data, headers={
                        "Accept": "application/sparql-results+json",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "User-Agent": "EarthView/0.1 (personal project)",
                    })
                    with urllib.request.urlopen(req, timeout=45) as r:
                        raw = r.read().decode("utf-8", "replace")
                return json.loads(raw)["results"]["bindings"]
            except Exception as e:  # noqa: BLE001
                last = str(e)[:70]
    raise RuntimeError(f"all strategies failed: {last}")


def parse(rows):
    out = []
    for b in rows:
        m = YEAR_RE.match(b["dob"]["value"])
        if not m:
            continue
        by = int(m.group(1))
        c = COORD_RE.search(b["bcoord"]["value"])
        if not c:
            continue
        blon, blat = float(c.group(1)), float(c.group(2))
        name = b.get("pLabel", {}).get("value", "")
        if not name or name.startswith("Q"):
            continue
        dy = dlat = dlon = None
        if "dod" in b:
            md = YEAR_RE.match(b["dod"]["value"])
            if md:
                dy = int(md.group(1))
        if "dcoord" in b:
            cd = COORD_RE.search(b["dcoord"]["value"])
            if cd:
                dlon, dlat = float(cd.group(1)), float(cd.group(2))
        sl = int(b["sl"]["value"])
        out.append({
            "qid": b["p"]["value"].rsplit("/", 1)[-1],
            "name": name,
            "by": by, "blat": blat, "blon": blon,
            "dy": dy, "dlat": dlat, "dlon": dlon,
            "sl": sl,
        })
    return out


def sub_windows(y0, y1, depth=0):
    """split a failed window into halves down to ~25-year slices"""
    if depth >= 4 or y1 - y0 <= 25:
        return [(y0, y1)]
    mid = (y0 + y1) // 2
    return sub_windows(y0, mid, depth + 1) + sub_windows(mid, y1, depth + 1)


def main():
    people = {}
    for i, (y0, y1) in enumerate(WINDOWS):
        ok = False
        for attempt in range(2):
            try:
                rows = run_chunk(y0, y1)
                got = parse(rows)
                ok = True
                break
            except Exception as e:  # noqa: BLE001
                print(f"  chunk {y0}..{y1} attempt {attempt + 1} failed: {str(e)[:80]}", flush=True)
                time.sleep(5)
        if not ok:
            print(f"  .. splitting failed chunk {y0}..{y1}", flush=True)
            for sub in sub_windows(y0, y1):
                try:
                    rows = run_chunk(*sub)
                    got = parse(rows)
                    for p_ in got:
                        if p_["qid"] not in people:
                            people[p_["qid"]] = p_
                except Exception as e2:  # noqa: BLE001
                    print(f"     !! {sub[0]}..{sub[1]} lost: {str(e2)[:60]}", flush=True)
            continue
        n_new = 0
        for p in got:
            if p["qid"] not in people:
                people[p["qid"]] = p
                n_new += 1
        print(f"  [{i + 1}/{len(WINDOWS)}] {y0}..{y1}: {len(got)} rows, {n_new} new (total {len(people)})", flush=True)
        time.sleep(1)
    out = sorted(people.values(), key=lambda p: p["by"])
    save_json("people.json", out)


if __name__ == "__main__":
    main()
