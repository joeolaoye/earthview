/** Coarse region derivation from lat/lon for stream grouping (ordered checks). */
const RULES: Array<[name: string, latMin: number, latMax: number, lonMin: number, lonMax: number]> = [
  ["Europe", 36, 72, -25, 45],
  ["Middle East & N. Africa", 12, 42, 25, 63],
  ["Africa", -37, 12, -20, 52],
  ["Southeast Asia", -12, 24, 92, 129],
  ["South & East Asia", -12, 55, 63, 146],
  ["Russia & Central Asia", 42, 78, 45, 180],
  ["Oceania", -50, -10, 110, 180],
  ["North America", 15, 72, -170, -50],
  ["Latin America", -55, 33, -120, -34],
];

export function regionOf(lat: number, lon: number): string {
  for (const [name, la, lb, oa, ob] of RULES) {
    if (lat >= la && lat <= lb && lon >= oa && lon <= ob) return name;
  }
  return "Open ocean & polar";
}
