/**
 * Nonlinear timeline: sparse ancient centuries are compressed, dense modern
 * decades expanded. Slider position is always in [0,1]; every position maps
 * to exactly one (fractional) astronomical year.
 */

const ANCHORS: Array<[year: number, weight: number]> = [
  [-1467, 4], [-800, 4], [-300, 4], [0, 5], [500, 5],
  [1000, 6], [1500, 8], [1800, 8], [1900, 12], [1950, 16], [2000, 28], [2026, 0],
];

const SPEEDS: Array<[aboveYear: number, yearsPerSec: number]> = [
  [-800, 30], [0, 20], [1500, 12], [1800, 6], [1900, 3], [1950, 1.2], [2000, 0.7], [Infinity, 0.4],
];

export class Timeline {
  readonly minYear: number;
  readonly maxYear: number;
  private segs: Array<{ y0: number; y1: number; p0: number; p1: number }> = [];

  constructor(minYear: number, maxYear: number) {
    this.minYear = minYear;
    this.maxYear = maxYear;
    const anchors = ANCHORS.filter(([y]) => y >= minYear && y <= maxYear);
    if (anchors[0][0] !== minYear) anchors.unshift([minYear, anchors[0][1] / 2]);
    if (anchors[anchors.length - 1][0] !== maxYear) anchors.push([maxYear, 0]);
    const totalW = anchors.slice(0, -1).reduce((s, [, w]) => s + w, 0);
    let acc = 0;
    for (let i = 0; i < anchors.length - 1; i++) {
      const [y0, w] = anchors[i];
      const [y1] = anchors[i + 1];
      const p0 = acc / totalW;
      acc += w;
      const p1 = i === anchors.length - 2 ? 1 : acc / totalW;
      this.segs.push({ y0, y1, p0, p1 });
    }
  }

  fromSlider(p: number): number {
    for (const { y0, y1, p0, p1 } of this.segs) {
      if (p <= p1 || y1 === this.maxYear) {
        const t = p1 === p0 ? 0 : Math.min(1, Math.max(0, (p - p0) / (p1 - p0)));
        return y0 + t * (y1 - y0);
      }
    }
    return this.maxYear;
  }

  toSlider(y: number): number {
    for (const { y0, y1, p0, p1 } of this.segs) {
      if (y <= y1 || y1 === this.maxYear) {
        const t = y1 === y0 ? 0 : Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
        return p0 + t * (p1 - p0);
      }
    }
    return 1;
  }

  speedAt(y: number): number {
    for (const [above, v] of SPEEDS) {
      if (y < above) return v;
    }
    return 0.4;
  }

  /** era tick marks for the slider track */
  ticks(): Array<{ p: number; label: string }> {
    const marks: Array<[number, string]> = [
      [-1467, "1468 BCE"], [-800, "801 BCE"], [-300, "301 BCE"], [0, "1 CE"],
      [1000, "1000"], [1500, "1500"], [1800, "1800"], [1900, "1900"], [1950, "1950"],
      [2026, "2026"],
    ];
    return marks
      .filter(([y]) => y >= this.minYear && y <= this.maxYear)
      .map(([y, label]) => ({ p: this.toSlider(y), label }));
  }
}

export function fmtYear(y: number): string {
  const yy = Math.floor(y);
  return yy <= 0 ? `${1 - yy} BCE` : `${yy} CE`;
}
