/**
 * DISABLED — reverted from the UI after review ("too gimmicky"). Kept on disk,
 * unimported, so it ships nowhere. Re-wire via main.ts if ever revived.
 *
 * Generative population-dispersal simulation (NOT a replay of any record).
 *
 * Reaction–diffusion model on the 0.5° world grid:
 *   growth:   dP = r·P·(1 − P/K)      (logistic, K from physical geography only)
 *   spread:   Fickian flux to land neighbours (mobility D)
 *
 * Carrying capacity K is built purely from physical inputs we hold:
 *   land mask (Natural Earth), latitude bands (temperature proxy), coastal
 *   proximity (marine resources), and a sea-level proxy that dilates the land
 *   mask over the continental shelf. No HYDE/historical data enters the model.
 */

import { rowYRanges, buildLandArray, GRID_W, GRID_H } from "./population";

export interface SimParams {
  r: number; // intrinsic growth rate /yr
  D: number; // mobility (cells²/yr)
  kCell: number; // nominal capacity per full-K cell (people)
  seaCells: number; // shelf exposure (0..6 cells ≈ sea-level drop)
  warmth: number; // 0.6..1.2 climate multiplier on polar capacity
  seedLon: number;
  seedLat: number;
}

export const DEFAULT_PARAMS: SimParams = {
  r: 0.002,
  D: 0.1,
  kCell: 300_000,
  seaCells: 0,
  warmth: 1.0,
  seedLon: 37,
  seedLat: 3, // East African Rift
};

const N = GRID_W * GRID_H;

/* precomputed 4-neighbour indices (-1 = none), built once */
const NEI = (() => {
  const a = new Int32Array(N * 4).fill(-1);
  for (let r = 0; r < GRID_H; r++) {
    for (let c = 0; c < GRID_W; c++) {
      const i = r * GRID_W + c;
      if (r > 0) a[i * 4] = i - GRID_W;
      if (r < GRID_H - 1) a[i * 4 + 1] = i + GRID_W;
      if (c > 0) a[i * 4 + 2] = i - 1;
      if (c < GRID_W - 1) a[i * 4 + 3] = i + 1;
    }
  }
  return a;
})();

/** Static physical carrying-capacity fraction per cell (0..1). */
function buildKfrac(warmth: number): Float32Array {
  const k = new Float32Array(N);
  for (let r = 0; r < GRID_H; r++) {
    const lat = 90 - (r + 0.5) * (180 / GRID_H);
    const a = Math.abs(lat);
    let latF = 1.0; // tropics/temperate productive
    if (a > 48) latF = 0.75;
    if (a > 58) latF = 0.4 * Math.max(0.4, warmth);
    if (a > 66) latF = 0.12 * Math.max(0.25, warmth);
    for (let c = 0; c < GRID_W; c++) k[r * GRID_W + c] = latF;
  }
  return k;
}

/** Chebyshev distance-to-land over ocean (BFS), for shelf exposure. */
function buildDistToLand(land: Uint8Array): Uint8Array {
  const dist = new Uint8Array(N).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < N; i++) {
    if (land[i]) {
      dist[i] = 0;
      frontier.push(i);
    }
  }
  let d = 0;
  while (frontier.length && d < 8) {
    const next: number[] = [];
    for (const i of frontier) {
      const r = (i / GRID_W) | 0;
      const c = i % GRID_W;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= GRID_H || cc < 0 || cc >= GRID_W) continue;
          const j = rr * GRID_W + cc;
          if (dist[j] === 255) {
            dist[j] = d + 1;
            next.push(j);
          }
        }
      }
    }
    frontier = next;
    d++;
  }
  return dist;
}

export class SimEngine {
  readonly P = new Float32Array(N);
  readonly kFrac: Float32Array;
  readonly distToLand: Uint8Array;
  readonly land: Uint8Array;
  params: SimParams;
  simYear = 0;
  readonly startYear: number;
  private eff: Uint8Array = new Uint8Array(N);
  // active region bounds (rows/cols) — keeps early steps near-free
  private r0 = GRID_H;
  private r1 = 0;
  private c0 = GRID_W;
  private c1 = 0;

  constructor(land: Uint8Array, startYear: number, params: SimParams) {
    this.land = land;
    this.startYear = startYear;
    this.params = { ...params };
    this.kFrac = buildKfrac(params.warmth);
    this.distToLand = buildDistToLand(land);
    // coastal-proximity bonus (marine resources) folded into static K fraction
    for (let i = 0; i < N; i++) {
      if (!land[i]) continue;
      const r = (i / GRID_W) | 0;
      const c = i % GRID_W;
      let nearOcean = false;
      for (let dr = -2; dr <= 2 && !nearOcean; dr++) {
        for (let dc = -2; dc <= 2 && !nearOcean; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= GRID_H || cc < 0 || cc >= GRID_W) continue;
          const d = this.distToLand[rr * GRID_W + cc];
          if (d > 0 && d <= 2) nearOcean = true;
        }
      }
      if (nearOcean) this.kFrac[i] = Math.min(1.25, this.kFrac[i] * 1.3);
    }
    this.reset(params);
  }

  private rebuildEff(): void {
    const lvl = this.params.seaCells;
    for (let i = 0; i < N; i++) {
      const d = this.distToLand[i];
      this.eff[i] = this.land[i] || (d > 0 && d <= lvl) ? 1 : 0;
    }
  }

  reset(params: SimParams): void {
    this.params = { ...params };
    this.rebuildEff();
    this.P.fill(0);
    this.simYear = this.startYear;
    if (SimEngine.scratch) SimEngine.scratch.fill(0);
    const sc = Math.round(((params.seedLon + 180) / 360) * (GRID_W - 1));
    const sr = Math.round(((90 - params.seedLat) / 180) * (GRID_H - 1));
    let sRow = sr;
    let sCol = sc;
    let seeded = false;
    for (let dr = -1; dr <= 1 && !seeded; dr++) {
      for (let dc = -1; dc <= 1 && !seeded; dc++) {
        const rr = sr + dr;
        const cc = sc + dc;
        if (rr >= 0 && rr < GRID_H && cc >= 0 && cc < GRID_W && this.eff[rr * GRID_W + cc]) {
          this.P[rr * GRID_W + cc] = 5000;
          sRow = rr;
          sCol = cc;
          seeded = true;
        }
      }
    }
    if (!seeded) this.P[Math.max(0, Math.min(GRID_H - 1, sr)) * GRID_W + Math.max(0, Math.min(GRID_W - 1, sc))] = 5000;
    // tight active bounds around the seed; growBounds expands as the wave spreads
    this.r0 = Math.max(0, sRow - 2);
    this.r1 = Math.min(GRID_H - 1, sRow + 2);
    this.c0 = Math.max(0, sCol - 2);
    this.c1 = Math.min(GRID_W - 1, sCol + 2);
  }

  setSeaCells(level: number): void {
    if (level === this.params.seaCells) return;
    this.params.seaCells = level;
    this.rebuildEff();
    this.growBounds();
  }

  private growBounds(): void {
    // one diffusion step can reach ~1 cell; keep a small safety margin
    this.r0 = Math.max(0, this.r0 - 2);
    this.r1 = Math.min(GRID_H - 1, this.r1 + 2);
    this.c0 = Math.max(0, this.c0 - 2);
    this.c1 = Math.min(GRID_W - 1, this.c1 + 2);
  }

  /** advance dt years (caller passes a stability-safe dt: D·dt ≤ 0.24) */
  step(dt: number): void {
    const { r, D, kCell } = this.params;
    const P = this.P;
    const eff = this.eff;
    const kF = this.kFrac;
    const dtD = Math.min(0.24, D * dt);
    const scratch = SimEngine.scratch ?? (SimEngine.scratch = new Float32Array(N));
    // expand active bounds slightly each step (frontier can only creep so far)
    this.growBounds();
    const { r0, r1, c0, c1 } = this;
    for (let row = r0; row <= r1; row++) {
      const base = row * GRID_W;
      for (let col = c0; col <= c1; col++) {
        const i = base + col;
        if (!eff[i]) {
          scratch[i] = 0;
          continue;
        }
        const p = P[i];
        // logistic growth toward local capacity
        const K = Math.max(1, kF[i] * kCell);
        let v = p + r * dt * p * (1 - p / K);
        // Fickian flux to effective-land neighbours
        let flux = 0;
        let n = 0;
        for (let k = 0; k < 4; k++) {
          const j = NEI[i * 4 + k];
          if (j < 0) continue;
          if (eff[j]) {
            flux += P[j];
            n++;
          }
        }
        if (n > 0) v += dtD * (flux - n * p);
        scratch[i] = v > 0 ? v : 0;
      }
    }
    P.set(scratch.subarray(0, N));
    this.simYear += dt;
  }

  get stableDt(): number {
    // explicit 5-point diffusion stability needs 4·D·dt ≤ ~1; keep margin
    return Math.min(1.0, 0.24 / Math.max(0.01, this.params.D));
  }

  total(): number {
    let s = 0;
    for (let i = 0; i < N; i++) s += this.P[i];
    return s;
  }

  private static scratch: Float32Array | null = null;
}

/* ---------- rendering (teal, mercator-warped, clipped to effective land) ---------- */

export class SimRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rows: Array<[number, number]>;
  private maskCanvases = new Map<number, HTMLCanvasElement>();
  private W: number;
  private H: number;
  private shelf: Uint8Array;

  constructor(
    private land: Uint8Array,
    private engine: SimEngine,
    width = 1440,
    height = 720
  ) {
    this.W = width;
    this.H = height;
    this.shelf = engine.distToLand.slice();
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.rows = rowYRanges(GRID_H, height);
  }

  private maskFor(level: number): HTMLCanvasElement {
    let mc = this.maskCanvases.get(level);
    if (mc) return mc;
    mc = document.createElement("canvas");
    mc.width = this.W;
    mc.height = this.H;
    const mctx = mc.getContext("2d")!;
    mctx.fillStyle = "#fff";
    mctx.beginPath();
    const cellW = this.W / GRID_W;
    for (let r = 0; r < GRID_H; r++) {
      const [yB, yT] = this.rows[r];
      if (yB - yT < 0.3) continue;
      const row = r * GRID_W;
      for (let c = 0; c < GRID_W; c++) {
        const i = row + c;
        const isLand = this.land[i] || (level > 0 && this.shelf[i] > 0 && this.shelf[i] <= level);
        if (!isLand) continue;
        mctx.rect(c * cellW, yT, cellW + 0.5, yB - yT + 0.5);
      }
    }
    mctx.fill();
    this.maskCanvases.set(level, mc);
    return mc;
  }

  render(): string {
    const P = this.engine.P;
    const ctx = this.ctx;
    const cellW = this.W / GRID_W;
    const kCell = this.engine.params.kCell;
    const logK = Math.log10(1 + kCell);
    ctx.clearRect(0, 0, this.W, this.H);
    for (let r = 0; r < GRID_H; r++) {
      const [yB, yT] = this.rows[r];
      if (yB - yT < 0.3) continue;
      const row = r * GRID_W;
      for (let c = 0; c < GRID_W; c++) {
        const p = P[row + c];
        if (p <= 30) continue;
        // compress the log scale so sparse frontier populations stay visible
        const t = Math.min(1, Math.pow(Math.log10(1 + p) / logK, 0.35));
        const x = c * cellW;
        ctx.fillStyle =
          t > 0.8
            ? `rgba(210,255,244,${(0.45 + t * 0.5).toFixed(3)})`
            : t > 0.5
              ? `rgba(90,230,205,${(0.3 + t * 0.55).toFixed(3)})`
              : `rgba(45,212,191,${(0.18 + t * 0.5).toFixed(3)})`;
        ctx.fillRect(x, yT, cellW, yB - yT);
      }
    }
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(this.maskFor(this.engine.params.seaCells), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return this.canvas.toDataURL("image/png");
  }
}

/** Pearson correlation of log sim population vs log-scaled evidence grid (0..255). */
export function correlation(sim: Float32Array, evidence: Float32Array, land: Uint8Array): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue;
    const x = Math.log10(1 + sim[i]);
    const y = (evidence[i] / 255) * 5;
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  if (n < 100) return 0;
  const mx = sx / n;
  const my = sy / n;
  const cov = sxy / n - mx * my;
  const vx = sxx / n - mx * mx;
  const vy = syy / n - my * my;
  if (vx < 1e-9 || vy < 1e-9) return 0;
  return cov / Math.sqrt(vx * vy);
}

export async function createSim(startYear: number, params: SimParams): Promise<{
  engine: SimEngine;
  renderer: SimRenderer;
  land: Uint8Array;
} | null> {
  const land = await buildLandArray();
  if (!land) return null;
  const engine = new SimEngine(land, startYear, params);
  const renderer = new SimRenderer(land, engine);
  return { engine, renderer, land };
}
