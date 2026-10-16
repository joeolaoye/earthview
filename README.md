# Earth View

**Live demo: [joeolaoye.github.io/earthview](https://joeolaoye.github.io/earthview/)**
(also served at [joeolaoye.co/earthview](https://joeolaoye.co/earthview/))

An interactive 3D-globe dashboard that animates recorded human events across the whole planet,
year by year, from **1468 BCE (battle of Megiddo) to 2026 CE** — wars, famines, earthquakes,
tsunamis, volcanic eruptions, and solar eclipses — with a scrubbable timeline, playback controls,
per-category layers, an "everything happening this year" stream with source links, and an
estimated world-population ticker.

Full project scope & roadmap: [`../earthview-dashboard-scope.md`](../earthview-dashboard-scope.md)

## Quick start

```bash
# 1. data pipeline (stdlib-only Python ≥3.10, fetches all sources)
cd pipeline
python3 fetch_wikidata.py      # battles 2500 BCE→2015 from Wikidata (CC0, ~60s)
python3 fetch_hiced.py         # HiCED conflicts 1468 BCE→2003 (Harvard Dataverse)
python3 fetch_owid.py          # world population + famines (OWID, CC-BY)
python3 fetch_eclipses.py      # NASA GSFC solar eclipse catalog (public domain, ~8 min)
python3 fetch_usgs.py          # USGS M6+ earthquakes 1900→2026 (public domain)
python3 fetch_curated.py       # curated famous tsunamis & eruptions
python3 build_events.py        # -> ../web/public/data/events.json + population.json

# 2. web app
cd ../web
npm install
npm run dev                    # http://localhost:5173
```

## Production build & deploy

```bash
cd web
npx vite build --outDir ../earthview-deploy --emptyOutDir
# self-contained static site (index.html + assets/ + data/, ~5.2 MB):
cd ../earthview-deploy && python3 -m http.server 4180
# host anywhere static: S3, GitHub Pages, Netlify — no backend, no keys
```

## Automated verification (headless Chrome, 29 end-to-end checks)

```bash
cd web
node verify/verify.mjs http://localhost:4180/    # against the deployed build
```

Covers: data load + full-span coverage, globe actually painting (screenshot pixel
analysis — basemap, cluster bubbles, category markers), initial 1939 state
(population ticker, event counts, stream, era ticks), playback/pause, era jump to
1468 BCE, year-jump (finds Waterloo in 1815), slider scrub to both ends, memory
slider, solo/show-all/category toggles, on-globe event click → popup with source
link, stream item click → fly-to, plus the population layer (epochs load, raster
changes across eras, toggle/opacity, visible heat contribution measured by pixel
analysis, exact ocean/land point probes). Note:
headless Chrome crashes randomly under
software WebGL in some environments; the harness phases each get their own
browser session and retry environmental crashes (real failures are never retried
away). Verified screenshot lands in `verify/verified-screenshot.png`.

## Analytics (PostHog) — off by default

The app ships tracker-free. To see how people use it, paste your PostHog
project key (Project Settings → API Key) into `POSTHOG_KEY` in
`web/src/analytics.ts` (and set `POSTHOG_HOST` to your region), rebuild, deploy.
`posthog-js` is dynamically imported — while the key is empty it costs zero
bytes and makes zero requests.

Once enabled: pageviews + autocapture, plus custom events —
`app_loaded`, `playback_play/pause`, `timeline_scrub`, `era_jump`, `year_jump`,
`speed_set`, `memory_set`, `layer_toggle`, `layer_solo`, `population_toggle`,
`popup_open`, `stream_flyto`, `google_search_click`, `popup_link_click` —
most carrying the active year/category so funnels can be cut by era or layer.
No personal data is tracked beyond standard PostHog session/device ids.

## Controls

- **Play / pause / fast-forward / rewind** (or `space`, `←`/`→` step, `shift+←/→` ×10)
- **Timeline slider** — nonlinear (ancient centuries compressed); scrub to any year
- **Speed** — 0.5×–4× multiplier over an era-adaptive base rate (ancient eras pass faster)
- **Layers panel** — toggle any category, `solo` shows one category only
- **Population heat** — HYDE 3.3 gridded estimates as an amber heat raster under
  the event markers; toggle + opacity slider; interpolates between epochs as time
  plays (watch the Black Death-era decline in 14th-century Europe)
- **Event memory** — how many years an event stays pinned before fading out
- **Jump to era** — presets (Megiddo, Marathon, Black Death, Tambora, WWII…) or type a year
  (`-1467` = 1468 BCE, or write `1468 bce`)
- **Stream panel (right)** — every recorded event for the current year grouped by region,
  with source links and a "G" Google-search link per event; click an item to fly the globe there
- **Globe** — drag to rotate, scroll to zoom; nearby events cluster into count-bubbles
  (click to expand); click any event for details + source + a "learn more" Google link;
  the biggest events get labels

## Data sources & licenses

| Category | Source | Coverage | License |
|---|---|---|---|
| Wars & battles | [Wikidata SPARQL](https://query.wikidata.org) (battles w/ coords) | 2500 BCE→2015 | CC0 |
| Wars & battles | [HiCED](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/6ZFC0V) | 1468 BCE→2003 | free w/ citation |
| Famines | [OWID](https://ourworldindata.org/famines) (World Peace Foundation) | 1870→2016 | CC-BY |
| Population ticker | [OWID](https://ourworldindata.org/grapher/population) (HYDE 3.3 + UN) | 10000 BCE→2023 | CC-BY |
| **Population heat layer** | **HYDE 3.3 gridded population (5′ netCDF → 0.5° epochs, zlib)**, [Klein Goldewijk et al.](https://essd.copernicus.org/articles/9/927/2017); clipped to Natural Earth 50m land | 28 epochs, 2000 BCE→2022, interpolated client-side | free w/ citation |
| Solar eclipses | [NASA GSFC Five Millennium Catalog](https://eclipse.gsfc.nasa.gov/SEcat5/SEcatalog.html) | 1468 BCE→2026 (total/annular/hybrid) | public domain |
| Earthquakes | [USGS FDSN](https://earthquake.usgs.gov/fdsnws/event/1/) | 1900→2026, M6+ | public domain |
| Tsunamis (pre-1900 + famous) | curated (this repo, `pipeline/fetch_curated.py`) | iconic events | see file |
| Volcanic eruptions | curated (this repo) | iconic pre-1900 events | see file |

**Population heat layer note:** HYDE's own distribution points at the Utrecht data
vault, which sits behind an authenticated portal; the pipeline therefore reads
`pipeline/raw/hyde/population.nc` fetched from the dataset's public Internet
Archive snapshot (URL recorded in `pipeline/build_popgrid.py`). Rebuild the layer
with:

```bash
cd pipeline
python3 -m venv .venv && .venv/bin/pip install netCDF4 numpy
.venv/bin/python build_popgrid.py
```

The layer is a reconstruction (estimates), log-scaled, aggregated to 0.5° cells,
compressed with zlib (inflated in-browser via `DecompressionStream`) and
interpolated between HYDE epochs as time plays — historical ebbs such as the
14th-century Black Death decline are visible in the underlying data. The raster
is drawn pre-warped to Web Mercator (so it aligns pixel-perfectly on both flat
and globe projections) and clipped to Natural Earth land polygons, so the heat
hugs coastlines and never bleeds over open ocean — verified by exact point
probes (0 heat pixels at mid-Atlantic/Indian-Ocean points; 73/81 warm at the Ganges).

Every popup/stream item links back to its source record.

### Known data gaps (follow-ups)

- **NOAA NCEI** tsunami (2100 BCE+) / significant earthquake (2150 BCE+) / significant
  volcanic eruption databases are the intended deep-history hazard sources, but their
  old direct-download endpoints are retired and the HaZEL web app hides its API
  (`pipeline/fetch_ncei.py` contains the discovery scaffold for when that's resolved).
  Until then: quakes are USGS 1900+; tsunamis/volcanoes pre-1900 are curated famous events.
- **EM-DAT** (all disaster types, 1900+) needs a free registration for non-commercial use —
  natural next addition.
- Wikidata battle coverage is uneven by region/era (Europe-heavy); HiCED fills the
  1468 BCE–2003 military record but with generic titles.

## Repo layout

```
pipeline/   Python ETL (stdlib only) — fetchers + build_events.py merge
web/        Vite + TypeScript + MapLibre GL JS (globe projection) app
```

## Tech notes

- MapLibre GL JS v5 globe projection, CARTO dark basemap (attribution required)
- GeoJSON source with native clustering; labels rendered as a collision-aware symbol
  layer capped to the ~48 most significant active events
- Events fade in ("flash"), hold, then fade out over the "memory" window; playback rate
  adapts to data density (ancient eras fast, modern years slow)
- All data is static JSON — no backend; the whole app can be served from any static host
