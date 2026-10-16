/**
 * HYDE 3.3 gridded population layer.
 *
 * 0.5° grid epochs (zlib-compressed), interpolated client-side, drawn into a
 * Web-Mercator-warped canvas so the raster aligns pixel-perfectly with the
 * basemap on both mercator and globe projections, then clipped to Natural
 * Earth land polygons so open ocean stays clean.
 */

export interface PopGridData {
  years: number[];
  w: number;
  h: number;
  encoding?: string;
  maxCellPop: number;
  grids: string[];
  note: string;
}

async function decodeGrid(s: string, encoding?: string): Promise<Uint8Array> {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (encoding !== "zlib+base64") return bytes;
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export class PopulationGrid {
  readonly years: number[];
  readonly w: number;
  readonly h: number;
  readonly grids: Uint8Array[];
  private cur: Float32Array;

  constructor(d: PopGridData, grids: Uint8Array[]) {
    this.years = d.years;
    this.w = d.w;
    this.h = d.h;
    this.grids = grids;
    this.cur = new Float32Array(d.w * d.h);
  }

  /** interpolated grid (log-scaled 0..255) at an astronomical year */
  sample(year: number): Float32Array {
    const ys = this.years;
    const n = ys.length;
    const cur = this.cur;
    if (year <= ys[0]) {
      const a = this.grids[0];
      for (let i = 0; i < cur.length; i++) cur[i] = a[i];
      return cur;
    }
    if (year >= ys[n - 1]) {
      const a = this.grids[n - 1];
      for (let i = 0; i < cur.length; i++) cur[i] = a[i];
      return cur;
    }
    let lo = 0;
    while (lo < n - 1 && ys[lo + 1] < year) lo++;
    const t = (year - ys[lo]) / (ys[lo + 1] - ys[lo]);
    const a = this.grids[lo];
    const b = this.grids[lo + 1];
    for (let i = 0; i < cur.length; i++) cur[i] = a[i] * (1 - t) + b[i] * t;
    return cur;
  }

  nearestEpoch(year: number): number {
    let best = this.years[0];
    for (const y of this.years) {
      if (Math.abs(y - year) < Math.abs(best - year)) best = y;
    }
    return best;
  }
}

/* ---------- mercator mapping ---------- */

/** simulation/land grid resolution (0.5°) shared across modules */
export const GRID_W = 720;
export const GRID_H = 360;

const MERC_MAX_LAT = 85.0511;
const MERC_MAX_Y = Math.log(Math.tan(Math.PI / 4 + (MERC_MAX_LAT * Math.PI) / 360));

export function latToY(lat: number, height: number): number {
  const clamped = Math.max(-MERC_MAX_LAT, Math.min(MERC_MAX_LAT, lat));
  const my = Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return ((1 - my / MERC_MAX_Y) / 2) * height;
}

export const POP_COORDINATES: [number, number][] = [
  [-180, MERC_MAX_LAT], [180, MERC_MAX_LAT], [180, -MERC_MAX_LAT], [-180, -MERC_MAX_LAT],
];

/** Precomputed per-row y-ranges for a grid of h rows (north first). */
export function rowYRanges(h: number, height: number): Array<[number, number]> {
  const rows: Array<[number, number]> = [];
  const step = 180 / h; // cell size in degrees
  for (let r = 0; r < h; r++) {
    const latTop = 90 - r * step;
    const latBottom = latTop - step;
    rows.push([latToY(latBottom, height), latToY(latTop, height)]); // [yBottom, yTop]
  }
  return rows;
}

/* ---------- land mask ---------- */

async function buildLandMask(width: number, height: number): Promise<HTMLCanvasElement | null> {
  let geo: any;
  try {
    const res = await fetch("data/land.geojson");
    if (!res.ok) return null;
    geo = await res.json();
  } catch {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  const polys: any[] =
    geo.type === "FeatureCollection"
      ? geo.features.map((f: any) => f.geometry)
      : Array.isArray(geo) ? geo : [geo];
  ctx.beginPath();
  for (const geom of polys) {
    if (!geom) continue;
    const mp = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    for (const poly of mp) {
      for (const ring of poly) {
        ring.forEach(([lon, lat]: [number, number], i: number) => {
          const x = ((lon + 180) / 360) * width;
          const y = latToY(lat, height);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
    }
  }
  ctx.fill("evenodd");
  return c;
}

/* ---------- renderer ---------- */

export class PopulationRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rows: Array<[number, number]>;
  private mask: HTMLCanvasElement | null = null;

  constructor(
    private grid: PopulationGrid,
    private width = 1440,
    private height = 720
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.rows = rowYRanges(grid.h, height);
  }

  async init(): Promise<void> {
    this.mask = await buildLandMask(this.width, this.height);
  }

  render(year: number): string {
    const g = this.grid.sample(year);
    const { w, h } = this.grid;
    const ctx = this.ctx;
    const W = this.width;
    const cellW = W / w;
    ctx.clearRect(0, 0, W, this.height);
    for (let r = 0; r < h; r++) {
      const [yB, yT] = this.rows[r];
      if (yB - yT < 0.3) continue; // beyond mercator edge
      const row = r * w;
      for (let col = 0; col < w; col++) {
        const v = g[row + col];
        if (v <= 2) continue;
        const t = v / 255;
        const x = col * cellW;
        // soft halo pass then core pass keeps a warm glow without cloudiness
        ctx.fillStyle = `rgba(240,130,55,${(0.06 + t * 0.45).toFixed(3)})`;
        ctx.fillRect(x - cellW * 0.4, yT - 0.8, cellW * 1.8, yB - yT + 1.6);
        ctx.fillStyle =
          t > 0.6
            ? `rgba(255,220,130,${(0.35 + t * 0.6).toFixed(3)})`
            : t > 0.3
              ? `rgba(250,170,70,${(0.25 + t * 0.55).toFixed(3)})`
              : `rgba(240,130,55,${(0.1 + t * 0.7).toFixed(3)})`;
        ctx.fillRect(x, yT, cellW, yB - yT);
      }
    }
    // clip everything to land — open ocean stays clean
    if (this.mask) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(this.mask, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
    return this.canvas.toDataURL("image/png");
  }
}

export async function loadPopGrid(): Promise<PopGridData | null> {
  try {
    const res = await fetch("data/popgrid.json");
    if (!res.ok) return null;
    return (await res.json()) as PopGridData;
  } catch {
    return null;
  }
}

/** Land mask on the regular 0.5° geographic grid (720x360, north first), rasterized from land.geojson. */
export async function buildLandArray(): Promise<Uint8Array | null> {
  let geo: any;
  try {
    const res = await fetch("data/land.geojson");
    if (!res.ok) return null;
    geo = await res.json();
  } catch {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = GRID_W;
  c.height = GRID_H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  const polys: any[] =
    geo.type === "FeatureCollection"
      ? geo.features.map((f: any) => f.geometry)
      : Array.isArray(geo) ? geo : [geo];
  for (const geom of polys) {
    if (!geom) continue;
    const mp = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    for (const poly of mp) {
      for (const ring of poly) {
        ring.forEach(([lon, lat]: [number, number], i: number) => {
          const x = ((lon + 180) / 360) * GRID_W;
          const y = ((90 - lat) / 180) * GRID_H; // plain equirect for the sim grid
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
    }
  }
  ctx.fill("evenodd");
  const alpha = ctx.getImageData(0, 0, GRID_W, GRID_H).data;
  const out = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < out.length; i++) out[i] = alpha[i * 4 + 3] > 127 ? 1 : 0;
  return out;
}

export async function buildPopulationLayer(
  d: PopGridData
): Promise<{ grid: PopulationGrid; renderer: PopulationRenderer } | null> {
  try {
    const grids: Uint8Array[] = [];
    for (const g of d.grids) grids.push(await decodeGrid(g, d.encoding));
    const grid = new PopulationGrid(d, grids);
    const renderer = new PopulationRenderer(grid);
    await renderer.init();
    return { grid, renderer };
  } catch (e) {
    console.warn("population layer unavailable:", e);
    return null;
  }
}
