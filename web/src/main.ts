import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import {
  loadEvents,
  loadPopulation,
  populationAt,
  type CatMeta,
  type EventIndex,
  type EventsData,
  type PopulationSeries,
} from "./data";
import { Timeline, fmtYear } from "./timeline";
import { renderStream, googleSearchUrl } from "./stream";
import {
  loadPopGrid,
  buildPopulationLayer,
  POP_COORDINATES,
  type PopulationGrid,
  type PopulationRenderer,
} from "./population";
import "./style.css";

const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const state = {
  year: 1900,
  playing: false,
  speedMult: 2,
  memory: 2,
  activeCats: new Set<number>(),
  soloCat: null as number | null,
  streamExpanded: false,
  popEnabled: true,
  popOpacity: 0.95,
};

let data: EventsData;
let idx: EventIndex;
let cats: CatMeta[];
let pop: PopulationSeries | null = null;
let popGrid: PopulationGrid | null = null;
let popRenderer: PopulationRenderer | null = null;
let lastPopBucket = -1;
let lastPopImageLen = 0;
let tl: Timeline;
let map: maplibregl.Map;
let mapReady = false;
let src: maplibregl.GeoJSONSource | null = null;
let lastGlobeKey = "";
let lastStreamYear = Number.NaN;
let forceStream = true;
let catCounts: number[] = [];

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const slider = $("slider") as HTMLInputElement;
const streamEl = $("stream");

/* ---------------- globe data ---------------- */

function activeCatsSet(): Set<number> {
  return state.soloCat !== null ? new Set([state.soloCat]) : state.activeCats;
}

function colorMatchExpr(): unknown[] {
  const m: unknown[] = ["match", ["get", "c"]];
  cats.forEach((c, i) => m.push(i, c.color));
  m.push("#ffffff");
  return m;
}

function updateGlobe(force = false): void {
  if (!mapReady || !src) return;
  const now = state.year;
  const key = `${Math.round(now * 8)}|${[...activeCatsSet()].sort().join(",")}|${state.memory}`;
  if (!force && key === lastGlobeKey) return;
  lastGlobeKey = key;

  const enabled = activeCatsSet();
  const memory = state.memory;
  const hold = memory * 0.25;
  const fade = memory - hold;

  const hi = idx.upperBound(now);
  const feats: any[] = [];
  catCounts = new Array(cats.length).fill(0);
  for (let i = hi - 1; i >= 0; i--) {
    const age = now - idx.years[i];
    if (age > memory) break;
    const c = idx.cat[i];
    if (!enabled.has(c)) continue;
    let a = 1;
    if (age > hold) a = Math.max(0, 1 - (age - hold) / fade);
    catCounts[c] += 1;
    feats.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [idx.lon[i], idx.lat[i]] },
      properties: {
        i,
        c,
        a: Math.round(a * 100) / 100,
        m: idx.mag[i],
        t: idx.title[i],
        f: age < 0.6 ? 1 : 0,
      },
    });
  }

  // label only the most significant active events; MapLibre handles collisions
  const rank = feats
    .map((f, k) => ({ k, s: f.properties.m * f.properties.a }))
    .sort((x, y) => y.s - x.s)
    .slice(0, 48)
    .map((x) => x.k);
  const labelSet = new Set(rank);
  feats.forEach((f, k) => (f.properties.lbl = labelSet.has(k) ? 1 : 0));

  src.setData({ type: "FeatureCollection", features: feats });
  $("active-count").textContent = String(feats.length);
  document.querySelectorAll<HTMLElement>("#cat-list .cat-row").forEach((row) => {
    row.querySelector(".count")!.textContent = String(catCounts[+row.dataset.cat!] || 0);
  });
}

function showPopup(i: number, coords: [number, number]): void {
  const c = cats[idx.cat[i]];
  const year = Math.floor(idx.years[i]);
  const link = idx.src[i]
    ? ` · <a href="${encodeURI(idx.src[i])}" target="_blank" rel="noopener">source ↗</a>`
    : "";
  const g = ` · <a href="${googleSearchUrl(idx.title[i], year, c.key)}" target="_blank" rel="noopener">learn more ↗</a>`;
  new maplibregl.Popup({ maxWidth: "300px", offset: 14 })
    .setLngLat(coords)
    .setHTML(
      `<span class="pop-chip" style="background:${c.color}">${c.label}</span>` +
        `<div class="pop-title">${escapeHtml(idx.title[i])}</div>` +
        `<div class="pop-meta">${fmtYear(year)}${link}${g}</div>`
    )
    .addTo(map);
}

/* ---------------- map setup ---------------- */

function initMap(): void {
  map = new maplibregl.Map({
    container: "globe",
    style: STYLE_URL,
    center: [15, 25],
    zoom: 1.3,
    attributionControl: { compact: true },
    pitchWithRotate: false,
    preserveDrawingBuffer: true, // lets tests/screenshots read the WebGL canvas
  });
  map.on("style.load", () => {
    try {
      map.setProjection({ type: "globe" });
    } catch {
      /* older maplibre: stay on mercator */
    }
    try {
      map.addLayer({ id: "sky", type: "sky", paint: { "sky-type": "atmosphere" } } as any);
    } catch {
      /* atmosphere optional */
    }
    addEventLayers();
  });
}

function addEventLayers(): void {
  // population heat raster (below all event layers)
  if (popGrid && popRenderer) {
    const url = popRenderer.render(state.year);
    lastPopImageLen = url.length;
    map.addSource("population", {
      type: "image",
      url,
      coordinates: POP_COORDINATES as unknown as [number, number][],
    });
    map.addLayer({
      id: "population-heat",
      type: "raster",
      source: "population",
      paint: {
        "raster-opacity": state.popOpacity,
        "raster-fade-duration": 0,
        "raster-resampling": "linear",
      },
    });
  }

  map.addSource("events", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterRadius: 55,
    clusterMaxZoom: 7,
  });
  src = map.getSource("events") as maplibregl.GeoJSONSource;

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "events",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#e8c877",
      "circle-opacity": 0.85,
      "circle-radius": [
        "interpolate", ["linear"], ["get", "point_count"],
        1, 13, 25, 18, 100, 25, 500, 32,
      ],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#171b24",
    },
  });
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "events",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Bold", "Open Sans Bold"],
      "text-size": 12,
    },
    paint: { "text-color": "#151a22" },
  });

  map.addLayer({
    id: "event-glow",
    type: "circle",
    source: "events",
    filter: ["!", ["has", "point_count"]],
    layout: { "circle-sort-key": ["get", "m"] },
    paint: {
      "circle-color": colorMatchExpr() as any,
      "circle-opacity": ["*", 0.28, ["get", "a"]],
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        0, ["+", 6, ["*", ["get", "m"], 12]],
        3, ["+", 9, ["*", ["get", "m"], 20]],
      ],
      "circle-blur": 1,
    },
  });
  map.addLayer({
    id: "event-point",
    type: "circle",
    source: "events",
    filter: ["!", ["has", "point_count"]],
    layout: { "circle-sort-key": ["get", "m"] },
    paint: {
      "circle-color": colorMatchExpr() as any,
      "circle-opacity": ["*", 0.95, ["get", "a"]],
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        0, ["+", ["+", 2, ["*", ["get", "m"], 4]], ["case", ["==", ["get", "f"], 1], 3, 0]],
        3, ["+", ["+", 2.5, ["*", ["get", "m"], 7]], ["case", ["==", ["get", "f"], 1], 4, 0]],
        6, ["+", ["+", 3, ["*", ["get", "m"], 12]], ["case", ["==", ["get", "f"], 1], 5, 0]],
      ],
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-opacity": ["*", 0.55, ["get", "a"]],
    },
  });
  map.addLayer({
    id: "event-labels",
    type: "symbol",
    source: "events",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "lbl"], 1]],
    layout: {
      "text-field": ["get", "t"],
      "text-font": ["Noto Sans Regular", "Open Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 0, 10.5, 3, 12, 6, 14],
      "text-anchor": "top",
      "text-offset": [0, 0.7],
      "text-optional": true,
      "text-max-width": 12,
      "symbol-sort-key": ["-", ["get", "m"]],
    },
    paint: {
      "text-color": "#f2f4f8",
      "text-halo-color": "rgba(5,7,11,0.9)",
      "text-halo-width": 1.3,
      "text-opacity": ["*", 0.95, ["get", "a"]],
    },
  });

  map.on("click", "clusters", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const cid = (f.properties as any).cluster_id;
    src!.getClusterExpansionZoom(cid).then((z) => {
      map.easeTo({ center: (f.geometry as any).coordinates, zoom: z + 0.2, duration: 600 });
    });
  });
  const popupHandler = (e: maplibregl.MapMouseEvent & { features?: any[] }) => {
    const f = e.features?.[0];
    if (!f) return;
    showPopup((f.properties as any).i, (f.geometry as any).coordinates);
  };
  map.on("click", "event-point", popupHandler);
  map.on("click", "event-labels", popupHandler);
  for (const l of ["event-point", "event-labels", "clusters"]) {
    map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
  }

  mapReady = true;
  updateGlobe(true);
  syncAll(true);
}

/* ---------------- playback + sync ---------------- */

function setPlaying(p: boolean): void {
  state.playing = p;
  $("t-play").textContent = p ? "⏸" : "▶";
  $("hint").classList.add("hidden");
}

function fmtPop(p: number): string {
  if (p >= 1e9) return (p / 1e9).toFixed(2) + " billion";
  if (p >= 1e6) return Math.round(p / 1e6) + " million";
  return Math.round(p / 1e3) + " thousand";
}

function syncAll(force = false): void {
  $("big-year").textContent = fmtYear(state.year);
  if (!sliderDrag) slider.value = String(tl.toSlider(state.year) * 1000);
  if (pop) {
    const p = populationAt(pop, Math.floor(state.year));
    if (p) $("pop-line").textContent = "est. world population ≈ " + fmtPop(p);
  }
  const yInt = Math.floor(state.year);
  if (force || yInt !== lastStreamYear) {
    lastStreamYear = yInt;
    renderStream(streamEl, idx, cats, yInt, state.streamExpanded, activeCatsSet());
  }
  updateGlobe();
  updatePopulationLayer(force);
}

function updatePopulationLayer(force = false): void {
  if (!popGrid || !popRenderer || !mapReady) return;
  if (!map.getLayer("population-heat")) return;
  const visible = state.popEnabled ? "visible" : "none";
  if (map.getLayoutProperty("population-heat", "visibility") !== visible) {
    map.setLayoutProperty("population-heat", "visibility", visible);
  }
  if (!state.popEnabled) return;
  const bucket = Math.floor(state.year / 2);
  if (!force && bucket === lastPopBucket) return;
  lastPopBucket = bucket;
  const url = popRenderer.render(state.year);
  lastPopImageLen = url.length;
  const src = map.getSource("population") as unknown as { updateImage?: (o: { url: string }) => void };
  src.updateImage?.({ url });
  const lbl = document.getElementById("pop-epoch-label");
  if (lbl) lbl.textContent = `≈${fmtYear(popGrid.nearestEpoch(state.year))} grid`;
}

let lastT = performance.now();
let sliderDrag = false;
let lastFrameAt = 0;

function frame(t: number): void {
  lastFrameAt = performance.now();
  advance(t);
  requestAnimationFrame(frame);
}

function advance(t?: number): void {
  const now = t ?? performance.now();
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  if (state.playing) {
    state.year += tl.speedAt(state.year) * state.speedMult * dt;
    if (state.year >= tl.maxYear) {
      state.year = tl.maxYear - 0.001;
      setPlaying(false);
    }
    syncAll();
  }
}

// rAF can stall entirely in background tabs and some embedded browsers;
// an interval fallback keeps the clock (and stream) advancing regardless
setInterval(() => {
  if (performance.now() - lastFrameAt > 400) advance();
}, 100);

/* ---------------- UI construction ---------------- */

function buildCatList(): void {
  const el = $("cat-list");
  el.innerHTML = "";
  cats.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "cat-row";
    row.dataset.cat = String(i);
    row.innerHTML =
      `<span class="dot" style="background:${c.color}"></span>` +
      `<label><input type="checkbox" checked /> ${c.label}</label>` +
      `<span class="count">0</span>` +
      `<button class="solo" title="show only this layer">solo</button>`;
    const cb = row.querySelector("input")!;
    cb.addEventListener("change", () => {
      state.soloCat = null;
      if (cb.checked) state.activeCats.add(i);
      else state.activeCats.delete(i);
      row.classList.toggle("off", !cb.checked);
      row.querySelector(".solo")!.classList.remove("on");
      forceStream = true;
      lastGlobeKey = "";
      syncAll(true);
    });
    row.querySelector(".solo")!.addEventListener("click", () => {
      setSolo(state.soloCat === i ? null : i);
    });
    el.appendChild(row);
  });
}

function setSolo(i: number | null): void {
  state.soloCat = i;
  document.querySelectorAll<HTMLElement>("#cat-list .cat-row").forEach((row) => {
    const ci = +row.dataset.cat!;
    const on = i === null ? state.activeCats.has(ci) : ci === i;
    (row.querySelector("input") as HTMLInputElement).checked = on;
    row.classList.toggle("off", !on);
    row.querySelector(".solo")!.classList.toggle("on", ci === i);
  });
  forceStream = true;
  lastGlobeKey = "";
  syncAll(true);
}

function buildTicks(): void {
  const el = $("ticks");
  const ticks = tl.ticks();
  let lastP = -100;
  el.innerHTML = ticks
    .filter((t) => {
      if (t.p * 100 - lastP < 6) return false;
      lastP = t.p * 100;
      return true;
    })
    .map((t) => `<span class="tick" style="left:${(t.p * 100).toFixed(1)}%">${t.label}</span>`)
    .join("");
}

function buildPresets(): void {
  const presets: Array<[number, string]> = [
    [-1467, "Megiddo"], [-490, "Marathon"], [0, "1 CE"], [1348, "Black Death"],
    [1492, "Columbus"], [1815, "Tambora"], [1914, "WWI"], [1939, "WWII"],
    [2004, "Sumatra"], [2024, "recent"],
  ];
  const el = $("era-presets");
  el.innerHTML = "";
  for (const [y, label] of presets) {
    const b = document.createElement("button");
    b.className = "mini";
    b.textContent = label;
    b.title = fmtYear(y);
    b.addEventListener("click", () => {
      state.year = y;
      lastGlobeKey = "";
      syncAll(true);
    });
    el.appendChild(b);
  }
}

function buildSpeeds(): void {
  const speeds = [0.5, 1, 2, 4];
  const el = $("speeds");
  el.innerHTML = "";
  for (const s of speeds) {
    const b = document.createElement("button");
    b.textContent = `${s}×`;
    if (s === state.speedMult) b.classList.add("on");
    b.addEventListener("click", () => {
      state.speedMult = s;
      el.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    });
    el.appendChild(b);
  }
}

function parseYearInput(s: string): number | null {
  s = s.trim().toLowerCase();
  if (!s) return null;
  const bce = /b\.?c/.test(s);
  const n = parseFloat(s.replace(/[^-\d.]/g, ""));
  if (Number.isNaN(n)) return null;
  return bce ? 1 - n : n;
}

function wireUI(): void {
  slider.addEventListener("pointerdown", () => (sliderDrag = true));
  slider.addEventListener("pointerup", () => (sliderDrag = false));
  slider.addEventListener("input", () => {
    state.year = tl.fromSlider(+slider.value / 1000);
    lastGlobeKey = "";
    syncAll();
  });

  $("t-play").addEventListener("click", () => setPlaying(!state.playing));
  $("t-start").addEventListener("click", () => {
    state.year = tl.minYear + 0.01;
    lastGlobeKey = "";
    syncAll(true);
  });
  $("t-end").addEventListener("click", () => {
    state.year = tl.maxYear - 0.01;
    lastGlobeKey = "";
    syncAll(true);
  });
  $("t-back").addEventListener("click", () => nudge(-10));
  $("t-fwd").addEventListener("click", () => nudge(10));

  $("memory").addEventListener("input", (e) => {
    state.memory = +(e.target as HTMLInputElement).value;
    $("memory-val").textContent = `${state.memory} yr`;
    lastGlobeKey = "";
    syncAll();
  });

  $("all-cats").addEventListener("click", () => {
    state.activeCats = new Set(cats.map((_, i) => i));
    setSolo(null);
  });

  const popToggle = document.getElementById("pop-toggle") as HTMLInputElement | null;
  popToggle?.addEventListener("change", () => {
    state.popEnabled = popToggle.checked;
    updatePopulationLayer(true);
  });
  const popOp = document.getElementById("pop-opacity") as HTMLInputElement | null;
  popOp?.addEventListener("input", () => {
    state.popOpacity = +popOp.value;
    const v = document.getElementById("pop-op-val");
    if (v) v.textContent = `${Math.round(state.popOpacity * 100)}%`;
    if (map.getLayer("population-heat")) {
      map.setPaintProperty("population-heat", "raster-opacity", state.popOpacity);
    }
  });

  $("jump-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const y = parseYearInput(($("jump-year") as HTMLInputElement).value);
    if (y === null) return;
    state.year = Math.min(tl.maxYear - 0.01, Math.max(tl.minYear + 0.01, y));
    lastGlobeKey = "";
    syncAll(true);
  });

  streamEl.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("a")) return; // let source links work
    if (t.closest("#stream-more")) {
      state.streamExpanded = true;
      syncAll(true);
      return;
    }
    const item = t.closest(".stream-item") as HTMLElement | null;
    if (item) {
      const i = +item.dataset.i!;
      const coords: [number, number] = [idx.lon[i], idx.lat[i]];
      map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 3.2), duration: 900 });
      showPopup(i, coords);
    }
  });

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.code === "Space") {
      e.preventDefault();
      setPlaying(!state.playing);
    } else if (e.code === "ArrowLeft") nudge(e.shiftKey ? -10 : -1);
    else if (e.code === "ArrowRight") nudge(e.shiftKey ? 10 : 1);
  });

  map.once("mousedown", () => $("hint").classList.add("hidden"));
}

function nudge(dy: number): void {
  state.year = Math.min(tl.maxYear - 0.01, Math.max(tl.minYear + 0.01, state.year + dy));
  lastGlobeKey = "";
  syncAll(true);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------------- boot ---------------- */

async function boot(): Promise<void> {
  const [loaded, popSeries, popGridData] = await Promise.all([
    loadEvents(),
    loadPopulation(),
    loadPopGrid(),
  ]);
  data = loaded.data;
  idx = loaded.idx;
  cats = data.categories;
  pop = popSeries;
  if (popGridData) {
    const built = await buildPopulationLayer(popGridData);
    if (built) {
      popGrid = built.grid;
      popRenderer = built.renderer;
    }
  }
  state.activeCats = new Set(cats.map((_, i) => i));
  tl = new Timeline(data.minYear, data.maxYear);

  buildCatList();
  buildTicks();
  buildPresets();
  buildSpeeds();
  initMap();
  wireUI();
  requestAnimationFrame(frame);

  // dev/testing handle (drives the same code paths as the UI)
  (window as unknown as Record<string, unknown>).__hs = {
    state,
    get map() {
      return map;
    },
    setYear: (y: number) => {
      state.year = y;
      lastGlobeKey = "";
      syncAll(true);
    },
    stats: () => ({ events: idx.n, cats: data.counts, years: [data.minYear, data.maxYear] }),
    popImageLen: () => lastPopImageLen,
    popEpochs: () => popGrid?.years ?? [],
  };
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<div style="color:#e7eaf0;font-family:sans-serif;padding:40px;line-height:1.6">` +
    `<h1>Failed to load data</h1><p>${String(err)}</p>` +
    `<p>Run the pipeline first: <code>cd pipeline &amp;&amp; python3 build_events.py</code> ` +
    `(see README for the fetchers).</p></div>`;
});
