"""Aggregate HYDE 3.3 gridded population (5' netCDF) into compact 2° epochs for the web.

Input:  raw/hyde/population.nc  (HYDE 3.3 baseline 'population', capita, 4320x2160, 126 epochs)
        - obtained from the Internet Archive snapshot of the Utrecht data vault
          (the live vault sits behind an authenticated portal; see README)
Output: ../web/public/data/popgrid.json
        { years: [...], w: 180, h: 90, grids: [<base64 Uint8 per epoch>], note }

Run with the pipeline venv:  .venv/bin/python build_popgrid.py
"""
import base64
import json
import os
import sys

import netCDF4 as nc
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
NC_PATH = os.path.join(HERE, "raw", "hyde", "population.nc")
OUT = os.path.join(HERE, "..", "web", "public", "data", "popgrid.json")

# timeline-relevant epochs (nearest available time slice is used per target)
TARGET_YEARS = [
    -2000, -1000, -500, 0, 500, 1000, 1200, 1300, 1400, 1450, 1500, 1600,
    1700, 1750, 1800, 1850, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970,
    1980, 1990, 2000, 2010, 2020,
]

COARSE = 6  # 6 x 6 five-arc-minute cells per 0.5° cell -> 720 x 360 world grid


def main():
    if not os.path.exists(NC_PATH):
        sys.exit("population.nc missing — see fetch instructions in README")
    ds = nc.Dataset(NC_PATH)
    tvar = ds.variables["time"]
    epoch = netCDF4_epoch_year(tvar)
    years_idx = epoch_to_year_index(tvar[:], epoch)
    pop = ds.variables["population"]
    lat = ds.variables["lat"][:]
    north_first = lat[0] > lat[-1]

    # choose nearest slice per target + always the final (most recent) slice
    picks = {}
    for ty in TARGET_YEARS:
        i = int(np.argmin(np.abs(years_idx - ty)))
        picks[i] = True
    picks[int(pop.shape[0]) - 1] = True
    idxs = sorted(picks)

    print(f"epochs in file: {len(years_idx)} ({years_idx[0]:.0f} .. {years_idx[-1]:.0f})")
    print(f"selected {len(idxs)} slices")

    grids = []
    sel_years = []
    world_totals = []
    vmax = 0.0
    for i in idxs:
        grid = np.ma.filled(pop[i], 0.0).astype(np.float64)  # _FillValue -> 0
        grid = np.nan_to_num(grid, nan=0.0, posinf=0.0, neginf=0.0)
        grid[grid < 0] = 0.0
        if not north_first:
            grid = grid[::-1, :]
        h, w = grid.shape
        ch, cw = h // COARSE, w // COARSE
        coarse = grid[: ch * COARSE, : cw * COARSE].reshape(ch, COARSE, cw, COARSE).sum(axis=(1, 3))
        vmax = max(vmax, float(coarse.max()))
        grids.append(coarse)
        sel_years.append(round(float(years_idx[i])))
        world_totals.append(float(coarse.sum()))

    # log-normalize to Uint8 on a single global scale (comparable across time),
    # then zlib-compress each epoch (sparse grids compress ~10-20x)
    import base64
    import zlib

    scale = np.log10(1.0 + vmax)
    payload = []
    for coarse in grids:
        u8 = np.clip(np.log10(1.0 + coarse) / scale * 255.0, 0, 255).astype(np.uint8)
        payload.append(base64.b64encode(zlib.compress(u8.tobytes(), 6)).decode("ascii"))

    out = {
        "years": sel_years,
        "w": grids[0].shape[1],
        "h": grids[0].shape[0],
        "encoding": "zlib+base64",
        "maxCellPop": round(vmax, 1),
        "grids": payload,
        "note": "HYDE 3.3 gridded population estimates (Klein Goldewijk et al.), aggregated to 0.5°, log-scaled",
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("max cell pop:", round(vmax))
    for y, t in zip(sel_years, world_totals):
        print(f"  {y:>6}: world {t/1e6:9.2f} M")
    print(f"wrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)")


def netCDF4_epoch_year(tvar):
    units = getattr(tvar, "units", "")
    # e.g. 'days since 1-5-1 00:00:00' (year-month-day, proleptic)
    try:
        cal = nc.num2date(0, tvar.units, getattr(tvar, "calendar", "standard"))
        return cal.year + cal.month / 12.0
    except Exception:
        return 1.0


def epoch_to_year_index(days, epoch_year):
    return np.asarray(days, dtype=np.float64) / 365.2425 + epoch_year


if __name__ == "__main__":
    main()
