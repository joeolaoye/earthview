"""People geo phase via the Wikidata ACTION API (no SPARQL): claims + sitelinks.

Stage A: wbgetentities (claims|sitelinks) per 40 qids -> dates, place refs, fame
Stage B: wbgetentities (claims) per 50 place-qids -> P625 coordinates
Checkpointed at every batch; merges into raw/people.json (build_events input).
"""
import json
import os
import time
import urllib.error
import urllib.parse

from fetch_common import http_get, load_json, save_json

WDAPI = "https://www.wikidata.org/w/api.php"
UA = {"User-Agent": "EarthView/0.1 (personal history project)"}
ENT_CKPT = "raw/entities_ckpt.json"
PLACE_CKPT = "raw/places_ckpt.json"


def wd_get(params):
    p = {"action": "wbgetentities", "format": "json", **params}
    url = WDAPI + "?" + urllib.parse.urlencode(p)
    for attempt in range(6):
        try:
            return json.loads(http_get(url, headers=UA, timeout=40, retries=1))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(min(float(e.headers.get("Retry-After") or 6), 15))
                continue
            break
        except Exception:  # noqa: BLE001
            time.sleep(4)
    return None


def year_from_time(t):
    if not t:
        return None
    m = re.match(r"^([+-]?\d+)", t)
    return int(m.group(1)) if m else None


def parse_entity(ent):
    claims = ent.get("claims", {})
    out = {"sl": len(ent.get("sitelinks", {}))}

    def claim_year(prop):
        c = claims.get(prop)
        if c:
            dv = c[0].get("mainsnak", {}).get("datavalue", {})
            return year_from_time(dv.get("value", {}).get("time"))
        return None

    def claim_place(prop):
        c = claims.get(prop)
        if c:
            dv = c[0].get("mainsnak", {}).get("datavalue", {})
            return dv.get("value", {}).get("id")
        return None

    out["by"] = claim_year("P569")
    out["dy"] = claim_year("P570")
    out["pb"] = claim_place("P19")
    out["pd"] = claim_place("P20")
    return out


def load_ckpt(path):
    if os.path.exists(path):
        try:
            return json.load(open(path))
        except Exception:  # noqa: BLE001
            pass
    return {}


def run_batches(ids, ckpt_path, make_params, parse_one, batch_size, label):
    ckpt = load_ckpt(ckpt_path)
    remaining = [i for i in ids if i not in ckpt]
    print(f"{label}: {len(ckpt)} cached, {len(remaining)} to fetch", flush=True)
    for i in range(0, len(remaining), batch_size):
        batch = remaining[i:i + batch_size]
        d = wd_get(make_params(batch))
        if d and "entities" in d:
            for qid, ent in d["entities"].items():
                if "missing" in ent:
                    ckpt[qid] = {}
                else:
                    rec = parse_one(ent)
                    if rec is not None:
                        ckpt[qid] = rec
        with open(ckpt_path, "w") as f:
            json.dump(ckpt, f)
        if (i // batch_size) % 10 == 0:
            print(f"  {label} batch {i // batch_size + 1}/{(len(remaining) + batch_size - 1) // batch_size}: {len(ckpt)}", flush=True)
        time.sleep(1.4)
    return ckpt


def main():
    import re
    qid_map = load_ckpt("raw/qids_ckpt.json")
    qid_list = sorted(set(qid_map.values()))
    print(f"people qids: {len(qid_list)}")

    ents = run_batches(
        qid_list, ENT_CKPT,
        lambda b: {"ids": "|".join(b), "props": "claims|sitelinks", "format": "json"},
        parse_entity, 40, "entities",
    )

    places = set()
    for rec in ents.values():
        for p in (rec.get("pb"), rec.get("pd")):
            if p:
                places.add(p)
    print(f"unique places: {len(places)}")

    def parse_place(ent):
        c = ent.get("claims", {}).get("P625")
        if c:
            dv = c[0].get("mainsnak", {}).get("datavalue", {}).get("value", {})
            return [dv.get("longitude"), dv.get("latitude")]
        return {}

    pl = run_batches(
        sorted(places), PLACE_CKPT,
        lambda b: {"ids": "|".join(b), "props": "claims"},
        parse_place, 50, "places",
    )

    # merge with phase-1 year-page info
    wiki = load_json("people_wiki.json", default=[])
    by_title = {}
    for e in wiki:
        if e["title"].isdigit() or len(e["title"]) < 2:
            continue
        p = by_title.setdefault(e["title"], {"name": e["name"], "by": None, "dy": None})
        if e["kind"] == "birth" and p["by"] is None:
            p["by"] = e["year"]
        if e["kind"] == "death" and p["dy"] is None:
            p["dy"] = e["year"]

    out = []
    n_coord = 0
    for title, info in by_title.items():
        qid = qid_map.get(title)
        if not qid:
            continue
        rec = ents.get(qid) or {}
        by = rec.get("by") if rec.get("by") is not None else info["by"]
        dy = rec.get("dy") if rec.get("dy") is not None else info["dy"]
        blat = blon = dlat = dlon = None
        pb, pd = rec.get("pb"), rec.get("pd")
        if pb and isinstance(pl.get(pb), list):
            blon, blat = pl[pb]
        if pd and isinstance(pl.get(pd), list):
            dlon, dlat = pl[pd]
        if blat is not None:
            n_coord += 1
        out.append({
            "qid": qid, "name": info["name"], "sl": rec.get("sl", 1),
            "by": by, "blat": blat, "blon": blon,
            "dy": dy, "dlat": dlat, "dlon": dlon,
        })
    out.sort(key=lambda p: (p["by"] if p["by"] is not None else 99999))
    print(f"people with birth coords: {n_coord}/{len(out)}")
    save_json("people.json", out)


import re  # noqa: E402
if __name__ == "__main__":
    main()
