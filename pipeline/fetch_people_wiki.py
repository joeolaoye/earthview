"""Notable people phase 1: harvest Births/Deaths lists from Wikipedia year pages.

Wikidata SPARQL proved too unstable for sitelinks queries, but the year pages
(1468 BC .. 2026) already carry editor-curated Births/Deaths sections -- a
built-in notability filter. One full-wikitext call per year, sections parsed
locally, 6 concurrent workers. Output: raw/people_wiki.json
  [{title, name, kind: "birth"|"death", year}]  (article title = person)

Phase 2 (fetch_people_geo.py) resolves titles -> qids -> coords + fame.
"""
import json
import re
import time
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from fetch_common import http_get, save_json

API = "https://en.wikipedia.org/w/api.php"
UA = {"User-Agent": "EarthView/0.1 (personal history project)"}

MIN_YEAR, MAX_YEAR = -1467, 2026

# [[Name]] or [[Name|Display]] at line start of a list entry
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]")
LINE_RE = re.compile(r"^\*+.*$", re.M)
MONTHS = ("january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december")


def is_date_title(t):
    low = t.lower().strip()
    first = low.split()[0] if low.split() else ""
    return (first in MONTHS) or (first.isdigit() and len(low.split()) == 2)


def year_title(y):
    return f"{1 - y} BC" if y <= 0 else str(y)


def fetch_year(y):
    """one wikitext call per year; parse Births/Deaths sections locally"""
    time.sleep(0.8)  # match the observed ~1s soft-throttle pace
    title = year_title(y)
    url = API + "?" + urllib.parse.urlencode({
        "action": "parse", "page": title, "prop": "wikitext",
        "format": "json", "formatversion": "2", "redirects": 1,
    })
    d = None
    for attempt in range(4):
        try:
            raw = http_get(url, headers=UA, timeout=40, retries=1)
            d = json.loads(raw)
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                STATS["r429"] += 1
                wait = float(e.headers.get("Retry-After") or 5)
                time.sleep(min(wait, 8))  # skip-long; failed years retry on a later pass
                continue
            break
        except Exception:  # noqa: BLE001
            time.sleep(2)
    if d is None:
        return y, None  # failed -> retryable
    page = d.get("parse", {})
    text = page.get("wikitext", "")
    if not text:
        return y, []
    found = []
    for kind in ("Births", "Deaths"):
        m = re.search(rf"^==[^=].*?{kind}.*?==\s*$", text, flags=re.M | re.I)
        if not m:
            continue
        rest = text[m.end():]
        nxt = re.search(r"^==[^=].*?==\s*$", rest, flags=re.M)
        body = rest[: nxt.start()] if nxt else rest
        for line in LINE_RE.finditer(body):
            links = [mm.group(1).strip() for mm in LINK_RE.finditer(line.group(0))]
            title = next((t for t in links if t and ":" not in t and not is_date_title(t)), None)
            if not title:
                continue
            found.append({
                "title": title,
                "name": title.replace("_", " "),
                "kind": kind.lower()[:-1],
                "year": y,
            })
    return y, found


CHECKPOINT = "raw/people_wiki_ckpt.json"
STATS = {"r429": 0}


def main():
    import os
    ckpt = {}
    if os.path.exists(CHECKPOINT):
        try:
            ckpt = {int(k): v for k, v in json.load(open(CHECKPOINT)).items()}
        except Exception:  # noqa: BLE001
            ckpt = {}
    years = [y for y in range(MIN_YEAR, MAX_YEAR + 1) if y not in ckpt or ckpt[y] is None]
    print(f"resuming: {len(range(MIN_YEAR, MAX_YEAR + 1)) - len(years)} years cached, {len(years)} to fetch", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=1) as ex:
        for y, found in ex.map(fetch_year, years):
            if found is None:
                continue  # leave uncached -> retried on a future run
            ckpt[y] = found
            done += 1
            if done % 100 == 0:
                with open(CHECKPOINT, "w") as f:
                    json.dump(ckpt, f)
                total = sum(len(v) for v in ckpt.values())
                print(f"  {done}/{len(years)} fetched, {total} entries, 429s={STATS['r429']} (ckpt {len(ckpt)} yrs)", flush=True)
    with open(CHECKPOINT, "w") as f:
        json.dump(ckpt, f)
    people = {}
    for entries in ckpt.values():
        for e in entries or []:
            key = (e["title"], e["kind"])
            people[key] = e
    out = sorted(people.values(), key=lambda p: (p["year"], p["kind"], p["title"]))
    save_json("people_wiki.json", out)


if __name__ == "__main__":
    main()
