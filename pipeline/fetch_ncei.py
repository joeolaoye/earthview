"""Best-effort: NOAA NCEI significant earthquakes / tsunami events / volcanic eruptions.

Discovers direct data-file links on the NCEI metadata landing pages and parses what it
finds. Public domain data. Any failure degrades gracefully (prints & exits 0).
"""
import csv
import io
import re
import zipfile
from urllib.parse import urljoin

from fetch_common import http_get, save_json

LANDING = {
    "tsunamis": "https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.hazards:G02151",
    "earthquakes": "https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.hazards:G02141",
    "volcanoes": "https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.hazards:G02137",
}

BC_RE = re.compile(r"(\d{1,4})\s*B\.?C\.?", re.I)


def parse_year(v):
    v = (v or "").strip()
    if not v:
        return None
    bc = BC_RE.search(v)
    if bc:
        return 1 - int(bc.group(1))  # astronomical year
    m = re.match(r"^(-?\d{4,5})", v)
    if m:
        y = int(m.group(1))
        return y if y < 1000 else y  # already yyyy, possibly negative
    return None


def parse_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def find_data_links(page_url):
    html = http_get(page_url, timeout=60)
    links = []
    for href, text in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S):
        label = re.sub(r"<[^>]+>", "", text).strip()
        blob = (href + " " + label).lower()
        if any(k in blob for k in ("download", ".csv", ".zip", "struts/results", "tsevent", "sigevent")):
            links.append((urljoin(page_url, href), label))
    return links


def sniff_table(name, url):
    """Fetch a candidate link; return list of dict rows if it looks like a data table."""
    try:
        data = http_get(url, timeout=120, as_bytes=True, retries=1)
    except Exception as e:  # noqa: BLE001
        print(f"    skip {url}: {e}")
        return None
    if data[:2] == b"PK":
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
            csvs = [n for n in zf.namelist() if n.lower().endswith((".csv", ".txt"))]
            if not csvs:
                return None
            data = zf.read(csvs[0])
        except Exception:  # noqa: BLE001
            return None
    try:
        txt = data.decode("utf-8-sig", "replace")
    except Exception:  # noqa: BLE001
        return None
    delim = "\t" if txt.count("\t") > txt.count(",") else ","
    rows = list(csv.reader(io.StringIO(txt), delimiter=delim))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if len(rows) < 5:
        return None
    header = [re.sub(r"[^A-Za-z0-9]+", "_", h.strip().lower()).strip("_") for h in rows[0]]
    if not any(("year" in h or "date" in h or "latitude" in h) for h in header):
        return None
    out = []
    for r in rows[1:]:
        d = dict(zip(header, (c.strip() for c in r)))
        out.append(d)
    print(f"    parsed table from {url.rsplit('/', 1)[-1]}: {len(out)} rows, cols={header[:8]}...")
    return out


def extract(name, rows):
    """Normalize NCEI rows to {title,year,lat,lon,deaths,mag}."""
    def get(d, *cands):
        for c in cands:
            for k, v in d.items():
                if c in k:
                    if v != "":
                        return v
        return None

    events = []
    for d in rows:
        year = parse_year(get(d, "year", "date", "event_date"))
        lat = parse_float(get(d, "latitude", "lat"))
        lon = parse_float(get(d, "longitude", "lon"))
        if year is None or lat is None or lon is None:
            continue
        title = (get(d, "name", "location_name", "event_name", "country", "volcano_name", "title") or name).strip()
        deaths = parse_float(get(d, "deaths", "total_deaths", "deaths_amount", "deaths_description"))
        mag = parse_float(get(d, "eq_primary", "primary_magnitude", "magnitude", "vei"))
        events.append({"title": title, "year": year, "lat": lat, "lon": lon,
                       "deaths": deaths, "mag": mag})
    return events


def main():
    for name, url in LANDING.items():
        print(f"discovering {name} via landing page...")
        try:
            links = find_data_links(url)
        except Exception as e:  # noqa: BLE001
            print(f"  landing page failed: {e}")
            continue
        print(f"  {len(links)} candidate links")
        rows = None
        for link, label in links[:12]:
            rows = sniff_table(name, link)
            if rows and len(rows) > 50:
                break
            rows = rows if rows and len(rows) > 50 else None
        if not rows:
            print(f"  !! no usable table found for {name}; skipping")
            continue
        events = extract(name, rows)
        print(f"  {name}: {len(events)} normalized events "
              f"(years {min((e['year'] for e in events), default=0)}..{max((e['year'] for e in events), default=0)})")
        save_json(f"ncei_{name}.json", events)


if __name__ == "__main__":
    main()
