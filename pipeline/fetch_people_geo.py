"""Notable people phase 2: qids, coordinates, dates, fame for the year-page harvest.

1) article titles -> wikidata qids  (MediaWiki prop=pageprops, 500 titles/call)
2) per-qid batch SPARQL (VALUES, 300/call): sitelinks, P569/P570, P19/P20 coords
   -- VALUES-bounded lookups are indexed and survive even a tired WDQS; the
   label-service rotation from phase attempts is kept as a fallback shape.

Output raw/people.json (consumed by build_events.py):
  {qid, name, by, blat, blon, dy, dlat, dlon, sl}
"""
import json
import re
import time
import urllib.parse
import urllib.request

from fetch_common import http_get, load_json, save_json

API = "https://en.wikipedia.org/w/api.php"
SPARQL = "https://query.wikidata.org/sparql"
UA = {"User-Agent": "EarthView/0.1 (personal history project)"}
YEAR_RE = re.compile(r"^(-?\d{1,5})")
COORD_RE = re.compile(r"Point\(([-\d.]+) ([-\d.]+)\)")

Q = """
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikbase: <http://wikiba.se/ontology#>
SELECT ?p ?sl ?dob ?dod ?bcoord ?dcoord WHERE {
  VALUES ?p { %s }
  OPTIONAL { ?p wikbase:sitelinks ?sl }
  OPTIONAL { ?p wdt:P569 ?dob }
  OPTIONAL { ?p wdt:P570 ?dod }
  OPTIONAL { ?p wdt:P19 ?pb . ?pb wdt:P625 ?bcoord }
  OPTIONAL { ?p wdt:P20 ?pd . ?pd wdt:P625 ?dcoord }
}
"""


QID_CKPT = "raw/qids_ckpt.json"


def title_to_qid(titles):
    import os
    out = {}
    if os.path.exists(QID_CKPT):
        try:
            out = json.load(open(QID_CKPT))
        except Exception:  # noqa: BLE001
            out = {}
    remaining = [t for t in titles if t not in out]
    print(f"qids cached: {len(out)}, to resolve: {len(remaining)}", flush=True)
    for i in range(0, len(remaining), 200):
        chunk = remaining[i:i + 50]
        p = {
            "action": "query", "format": "json", "formatversion": "2",
            "titles": "|".join(chunk), "prop": "pageprops", "ppprop": "wikibase_item",
            "redirects": 1,
        }
        url = API + "?" + urllib.parse.urlencode(p)
        d = None
        for attempt in range(6):
            try:
                d = json.loads(http_get(url, headers=UA, timeout=40, retries=1))
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(min(float(e.headers.get("Retry-After") or 6), 15))
                    continue
                break
            except Exception:  # noqa: BLE001
                time.sleep(3)
        if d is None:
            print(f"  !! chunk {i // 50 + 1} unresolved after retries", flush=True)
            continue
        pages = d.get("query", {}).get("pages", [])
        norm = {}
        for r in d.get("query", {}).get("redirects", []):
            norm[r.get("to")] = r.get("from")
        for pg in pages:
            qid = (pg.get("pageprops") or {}).get("wikibase_item")
            if qid:
                out[pg["title"]] = qid
                if pg["title"] in norm:
                    out[norm[pg["title"]]] = qid
        with open(QID_CKPT, "w") as f:
            json.dump(out, f)
        if (i // 50) % 10 == 0:
            print(f"  qid batch {i // 50 + 1}/{(len(remaining) + 49) // 50}: {len(out)} resolved", flush=True)
        time.sleep(1.6)
    with open(QID_CKPT, "w") as f:
        json.dump(out, f)
    return out


GEO_CKPT = "raw/geo_ckpt.json"


def sparql_batch(qids):
    values = " ".join(f"wd:{q}" for q in qids)
    q = Q % values
    url = SPARQL + "?format=json&query=" + urllib.parse.quote(q)
    for attempt in range(6):
        try:
            raw = http_get(url, headers={"Accept": "application/sparql-results+json"}, timeout=30, retries=1)
            d = json.loads(raw)
            out = {}
            for b in d["results"]["bindings"]:
                qid = b["p"]["value"].rsplit("/", 1)[-1]
                rec = out.setdefault(qid, {})
                if "sl" in b:
                    rec["sl"] = int(b["sl"]["value"])
                for k, prop in (("dob", "dob"), ("dod", "dod")):
                    if prop in b:
                        m = YEAR_RE.match(b[prop]["value"])
                        if m:
                            rec[k] = int(m.group(1))
                for k, prop in (("bcoord", "bcoord"), ("dcoord", "dcoord")):
                    if prop in b:
                        c = COORD_RE.search(b[prop]["value"])
                        if c:
                            rec[k] = (float(c.group(1)), float(c.group(2)))  # (lon, lat)
            return out
        except Exception:  # noqa: BLE001
            time.sleep(9)
    return {}


def main():
    wiki = load_json("people_wiki.json", default=[])
    if not wiki:
        raise SystemExit("run fetch_people_wiki.py first")
    print(f"phase-1 entries: {len(wiki)}")

    # collapse to unique person titles (skip bare year/date links)
    by_title = {}
    for e in wiki:
        if e["title"].isdigit() or len(e["title"]) < 2:
            continue
        p = by_title.setdefault(e["title"], {"name": e["name"], "birth_year": None, "death_year": None})
        if e["kind"] == "birth" and p["birth_year"] is None:
            p["birth_year"] = e["year"]
        if e["kind"] == "death" and p["death_year"] is None:
            p["death_year"] = e["year"]
    titles = sorted(by_title)
    print(f"unique people: {len(titles)}")

    qids = title_to_qid(titles)
    print(f"resolved qids: {len(qids)}")

    qid_list = sorted(set(qids.values()))
    import os
    merged = {}
    if os.path.exists(GEO_CKPT):
        try:
            merged = json.load(open(GEO_CKPT))
        except Exception:  # noqa: BLE001
            merged = {}
    qid_list = [q for q in qid_list if q not in merged]
    print(f"geo cached: {len(merged)}, remaining: {len(qid_list)}", flush=True)
    for i in range(0, len(qid_list), 150):
        batch = qid_list[i:i + 150]
        got = sparql_batch(batch)
        for qid, rec in got.items():
            merged[qid] = rec
        with open(GEO_CKPT, "w") as f:
            json.dump(merged, f)
        print(f"  geo batch {i // 150 + 1}/{(len(qid_list) + 149) // 150}: {len(merged)} resolved", flush=True)
        time.sleep(1.2)

    out = []
    n_coord = 0
    for title, info in by_title.items():
        qid = qids.get(title)
        if not qid:
            continue
        g = merged.get(qid, {})
        by = g.get("dob")
        if by is None:
            m = None
            by = info["birth_year"]
        dy = g.get("dod")
        if dy is None:
            dy = info["death_year"]
        blat = blon = dlat = dlon = None
        if "bcoord" in g:
            blon, blat = g["bcoord"]
        if "dcoord" in g:
            dlon, dlat = g["dcoord"]
        if blat is not None:
            n_coord += 1
        out.append({
            "qid": qid,
            "name": info["name"],
            "by": by, "blat": blat, "blon": blon,
            "dy": dy, "dlat": dlat, "dlon": dlon,
            "sl": g.get("sl", 1),
        })
    out.sort(key=lambda p: (p["by"] if p["by"] is not None else 99999))
    print(f"people with birth coords: {n_coord}/{len(out)}")
    save_json("people.json", out)


if __name__ == "__main__":
    main()
