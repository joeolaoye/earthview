export interface CatMeta {
  key: string;
  label: string;
  color: string;
}
/** [year, lat, lon, catIdx, title, mag, srcUrl] — years are astronomical (1 BCE = 0). */
export type RawEvent = [number, number, number, number, string, number, string];

export interface EventsData {
  minYear: number;
  maxYear: number;
  categories: CatMeta[];
  events: RawEvent[];
  counts?: Record<string, number>;
}

export class EventIndex {
  readonly n: number;
  readonly years: Float64Array;
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  readonly cat: Uint8Array;
  readonly mag: Float32Array;
  readonly title: string[];
  readonly src: string[];

  constructor(d: EventsData) {
    const evs = [...d.events].sort((a, b) => a[0] - b[0]);
    this.n = evs.length;
    this.years = new Float64Array(this.n);
    this.lat = new Float64Array(this.n);
    this.lon = new Float64Array(this.n);
    this.cat = new Uint8Array(this.n);
    this.mag = new Float32Array(this.n);
    this.title = new Array<string>(this.n);
    this.src = new Array<string>(this.n);
    for (let i = 0; i < this.n; i++) {
      const e = evs[i];
      this.years[i] = e[0];
      this.lat[i] = e[1];
      this.lon[i] = e[2];
      this.cat[i] = e[3];
      this.mag[i] = e[5];
      this.title[i] = e[4];
      this.src[i] = e[6];
    }
  }

  /** index of first event with year > y */
  upperBound(y: number): number {
    let lo = 0;
    let hi = this.n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.years[m] <= y) lo = m + 1;
      else hi = m;
    }
    return lo;
  }
}

export async function loadEvents(): Promise<{ data: EventsData; idx: EventIndex }> {
  const res = await fetch("data/events.json");
  if (!res.ok) throw new Error(`events.json: HTTP ${res.status}`);
  const data = (await res.json()) as EventsData;
  return { data, idx: new EventIndex(data) };
}

export type PopulationSeries = [number, number][];

export async function loadPopulation(): Promise<PopulationSeries | null> {
  try {
    const res = await fetch("data/population.json");
    if (!res.ok) return null;
    return (await res.json()) as PopulationSeries;
  } catch {
    return null;
  }
}

export function populationAt(pop: PopulationSeries, year: number): number | null {
  if (!pop.length) return null;
  let lo = 0;
  let hi = pop.length - 1;
  if (year <= pop[0][0]) return pop[0][1];
  if (year >= pop[hi][0]) return pop[hi][1];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pop[m][0] <= year) lo = m;
    else hi = m;
  }
  const t = (year - pop[lo][0]) / (pop[hi][0] - pop[lo][0]);
  return pop[lo][1] * (1 - t) + pop[hi][1] * t;
}

/** compact person records for the alive panel: [name, birthYear, deathYear(-1 unknown), sitelinks] */
export type RawPerson = [string, number, number, number];

export async function loadPeople(): Promise<RawPerson[]> {
  try {
    const res = await fetch("data/people.json");
    if (!res.ok) return [];
    return (await res.json()) as RawPerson[];
  } catch {
    return [];
  }
}
