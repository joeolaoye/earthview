import type { EventIndex, CatMeta } from "./data";
import { regionOf } from "./regions";
import { fmtYear } from "./timeline";

export interface StreamEvent {
  i: number;
  title: string;
  cat: number;
  mag: number;
  lat: number;
  lon: number;
  src: string;
}

const CAP = 150;

/** Google search URL to learn more about an event (opens in a new tab). */
export function googleSearchUrl(title: string, year: number, catKey: string): string {
  const suffix: Record<string, string> = {
    earthquake: "earthquake",
    tsunami: "tsunami",
    volcano: "volcanic eruption",
  };
  const q = `${title} ${fmtYear(year)}${suffix[catKey] ? " " + suffix[catKey] : ""}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function collectYearEvents(idx: EventIndex, yearInt: number): StreamEvent[] {
  const lo = idx.upperBound(yearInt - 1e-9);
  const hi = idx.upperBound(yearInt + 1 - 1e-9);
  const out: StreamEvent[] = [];
  for (let i = lo; i < hi; i++) {
    out.push({
      i,
      title: idx.title[i],
      cat: idx.cat[i],
      mag: idx.mag[i],
      lat: idx.lat[i],
      lon: idx.lon[i],
      src: idx.src[i],
    });
  }
  return out;
}

export function renderStream(
  container: HTMLElement,
  idx: EventIndex,
  cats: CatMeta[],
  yearInt: number,
  expanded: boolean,
  activeCats: Set<number>
): void {
  const evs = collectYearEvents(idx, yearInt)
    .filter((e) => activeCats.has(e.cat))
    .sort((a, b) => b.mag - a.mag);

  let html = `<div class="stream-head">
    <span class="stream-year">${fmtYear(yearInt)}</span>
    <span class="stream-sub">${evs.length} recorded event${evs.length === 1 ? "" : "s"} this year</span>
  </div>`;

  if (!evs.length) {
    html += `<div class="stream-empty">No recorded events for this year in the current selection.</div>`;
    container.innerHTML = html;
    return;
  }

  // group by region
  const groups = new Map<string, StreamEvent[]>();
  for (const e of evs) {
    const r = regionOf(e.lat, e.lon);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(e);
  }
  const regions = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  const cap = expanded ? 2000 : CAP;
  let shown = 0;
  let hidden = 0;
  for (const [region, list] of regions) {
    html += `<div class="stream-region">${region} <span class="stream-count">${list.length}</span></div>`;
    for (const e of list) {
      if (shown >= cap) {
        hidden += 1;
        continue;
      }
      shown += 1;
      const c = cats[e.cat];
      const g = googleSearchUrl(e.title, yearInt, c.key);
      html += `<div class="stream-item" data-i="${e.i}">
        <span class="dot" style="background:${c.color}"></span>
        <div class="stream-item-body">
          <div class="stream-item-title">${escapeHtml(e.title)}</div>
          <div class="stream-item-meta">${c.label}</div>
        </div>
        <a class="g-link" href="${g}" target="_blank" rel="noopener" title="learn more (Google)">G</a>
        ${e.src ? `<a class="src-link" href="${encodeURI(e.src)}" target="_blank" rel="noopener" title="source">↗</a>` : ""}
      </div>`;
    }
  }
  if (hidden > 0) {
    html += `<button class="stream-more" id="stream-more">show ${Math.min(hidden, 2000 - shown)} more…</button>`;
  }
  container.innerHTML = html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
