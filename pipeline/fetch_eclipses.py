"""Scrape NASA GSFC Five Millennium Catalog of Solar Eclipses (-1999..+3000).

Century pages embed the catalog as <pre> formatted text (one eclipse per line),
split across several blocks. Keeps total/annular/hybrid eclipses as point events
at greatest-eclipse coordinates. NASA content is public domain.
"""
import html as htmlmod
import re
from urllib.parse import urljoin

from fetch_common import http_get, save_json

INDEX = "https://eclipse.gsfc.nasa.gov/SEcat5/SEcatalog.html"
MONTH_RE = re.compile(r"^[A-S][a-z]{2}$")
TYPE_RE = re.compile(r"^([ATHP])[np+-]{0,2}$")
LAT_RE = re.compile(r"^([\d.]+)([NS])$")
LON_RE = re.compile(r"^([\d.]+)([EW])$")
FLOAT_RE = re.compile(r"^-?[\d.]+$")


def parse_pre_text(txt):
    """Yield (year, type, lat, lon) from pre-block text lines."""
    for line in txt.splitlines():
        toks = line.split()
        if len(toks) < 13:
            continue
        # month at index 2: catno year month day time ...
        if not MONTH_RE.match(toks[2]) or not re.match(r"^-?\d{1,5}$", toks[1]):
            continue
        if not re.match(r"^\d{2}:\d{2}:\d{2}$", toks[4] or ""):
            continue
        try:
            year = int(toks[1])
            day = int(toks[3])
        except ValueError:
            continue
        # scan after time for the type token
        for j in range(5, min(len(toks) - 4, 12)):
            mt = TYPE_RE.match(toks[j])
            if not mt:
                continue
            rest = toks[j + 1:]
            if len(rest) < 4:
                break
            # optional QLE token follows type; find gamma/mag floats then lat/lon
            k = 0
            if FLOAT_RE.match(rest[0]) and FLOAT_RE.match(rest[1]):
                gamma_i = 0
            elif len(rest) > 2 and FLOAT_RE.match(rest[1]) and FLOAT_RE.match(rest[2]):
                gamma_i = 1  # QLE token at rest[0]
            else:
                break
            mlat = LAT_RE.match(rest[gamma_i + 2])
            mlon = LON_RE.match(rest[gamma_i + 3])
            if not (mlat and mlon):
                break
            lat = float(mlat.group(1)) * (1 if mlat.group(2) == "N" else -1)
            lon = float(mlon.group(1)) * (1 if mlon.group(2) == "E" else -1)
            yield year, mt.group(1), lat, lon
            break


def main():
    idx_html = http_get(INDEX, timeout=60)
    links = set()
    for href in re.findall(r'href="([^"]+)"', idx_html):
        u = urljoin(INDEX, href)
        if "SEcat5/" in u and u.endswith(".html") and "catalog" not in u.lower():
            links.add(u)
    links = sorted(links)
    print(f"found {len(links)} pages (NASA is ~8s/page; this takes ~8 min)")
    events = []
    for i, page in enumerate(links):
        try:
            html = http_get(page, timeout=90, retries=2)
        except Exception as e:  # noqa: BLE001
            print(f"  !! {page}: {e}")
            continue
        got = 0
        for pre in re.findall(r"<pre>(.*?)</pre>", html, re.S | re.I):
            txt = htmlmod.unescape(re.sub(r"<[^>]+>", " ", pre))
            for year, etype, lat, lon in parse_pre_text(txt):
                events.append({"year": year, "type": etype, "lat": lat, "lon": lon, "src": page})
                got += 1
        print(f"  [{i + 1}/{len(links)}] {page.rsplit('/', 1)[-1]}: {got}", flush=True)
    # dedupe
    seen = set()
    out = []
    for e in events:
        k = (e["year"], e["type"], e["lat"], e["lon"])
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    print(f"total T/A/H eclipse events: {len(out)}")
    save_json("eclipses.json", out)


if __name__ == "__main__":
    main()
