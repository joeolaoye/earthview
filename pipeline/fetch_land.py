"""Download Natural Earth 50m land polygons (public domain) for raster clipping.

Falls back to the 110m version if the 50m file is unavailable.
"""
from fetch_common import http_get

import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "data", "land.geojson")
URLS = [
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson",
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson",
]


def main():
    for url in URLS:
        try:
            txt = http_get(url, timeout=120)
            if len(txt) > 100_000:
                with open(OUT, "w", encoding="utf-8") as f:
                    f.write(txt)
                print(f"wrote {OUT} ({len(txt)} bytes) from {url.rsplit('/', 1)[-1]}")
                return
        except Exception as e:  # noqa: BLE001
            print(f"  {url}: {e}")
    raise SystemExit("no land geojson source reachable")


if __name__ == "__main__":
    main()
