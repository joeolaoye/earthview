"""Best-effort: HiCED Historical Conflict Event Dataset from Harvard Dataverse.

Public dataset (DOI 10.7910/DVN/6ZFC0V). Degrades gracefully if guest download is blocked.
"""
import csv
import io
import json
import re
import zipfile

from fetch_common import http_get, save_json

API = ("https://dataverse.harvard.edu/api/datasets/:persistentId/"
       "?persistentId=doi:10.7910/DVN/6ZFC0V")


def norm_header(h):
    return re.sub(r"[^a-z0-9]+", "_", h.strip().lower()).strip("_")


def main():
    print("querying dataverse for HiCED file list...")
    try:
        meta = json.loads(http_get(API, timeout=60))
    except Exception as e:  # noqa: BLE001
        print(f"  !! dataverse API failed: {e}")
        return
    files = []
    for f in meta.get("data", {}).get("latestVersion", {}).get("files", []):
        df = f.get("dataFile", {})
        files.append({"id": df.get("id"), "name": df.get("filename", ""),
                      "size": df.get("filesize", 0), "ct": df.get("contentType", "")})
    print(f"  files: {[(f['name'], f['ct'], f['size']) for f in files]}")
    # prefer CSV; fall back to zips
    files.sort(key=lambda f: (0 if "csv" in f["ct"] else 1 if "zip" in f["ct"] else 2))
    for f in files[:4]:
        if f["size"] > 200 * 1024 * 1024:
            continue
        url = f"https://dataverse.harvard.edu/api/access/datafile/{f['id']}"
        try:
            data = http_get(url, timeout=180, as_bytes=True, retries=1)
        except Exception as e:  # noqa: BLE001
            print(f"  download {f['name']} failed: {e}")
            continue
        if data[:2] == b"PK":
            try:
                zf = zipfile.ZipFile(io.BytesIO(data))
                members = [n for n in zf.namelist() if n.lower().endswith((".csv", ".txt"))]
                if not members:
                    continue
                data = zf.read(members[0])
            except Exception:  # noqa: BLE001
                continue
        try:
            txt = data.decode("utf-8-sig", "replace")
        except Exception:  # noqa: BLE001
            continue
        delim = "\t" if txt.count("\t") > txt.count(",") else ","
        rows = list(csv.reader(io.StringIO(txt), delimiter=delim))
        if len(rows) < 100:
            continue
        header = [norm_header(h) for h in rows[0]]
        print(f"  parsed {f['name']}: {len(rows) - 1} rows; header={header}")
        out = []
        for r in rows[1:]:
            d = dict(zip(header, r))

            def g(*cands):
                for c in cands:
                    if c in d and d[c] != "":
                        return d[c]
                return None

            year = None
            yraw = g("year", "yr", "event_year", "start_year")
            if yraw:
                try:
                    year = int(float(yraw))
                except (TypeError, ValueError):
                    year = None
            try:
                lat = float(g("latitude", "lat", "y") or "nan")
                lon = float(g("longitude", "lon", "x") or "nan")
            except ValueError:
                lat = lon = None
            if year is None or lat is None or lon is None or lat != lat or lon != lon:
                continue
            title = (g("event_name", "name", "battle", "conflict_name", "event") or "Armed confrontation").strip()
            deaths = None
            draw = g("fatalities", "deaths", "casualties", "battle_deaths")
            if draw:
                try:
                    deaths = float(draw)
                except (TypeError, ValueError):
                    pass
            out.append({"title": title, "year": year, "lat": lat, "lon": lon, "deaths": deaths})
        if len(out) > 500:
            print(f"  HiCED normalized: {len(out)} events")
            save_json("hiced.json", out)
            return
    print("  !! no usable HiCED file obtained; wars will rely on Wikidata battles")


if __name__ == "__main__":
    main()
