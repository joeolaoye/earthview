"""Fetch Our World in Data CSVs: world population (10000 BCE..2023) and famines (1840s..).

OWID grapher CSVs are CC-BY. Famines are geocoded to country centroids via keyword map.
"""
import csv
import io
import re

from fetch_common import http_get, save_json

# keyword -> representative centroid (lat, lon) for famine locations
CENTROIDS = {
    "bengal": (23.7, 88.0), "bangladesh": (23.7, 90.4), "india": (22.9, 79.0),
    "china": (35.0, 105.0), "soviet": (55.0, 45.0), "russia": (58.0, 50.0),
    "ukraine": (49.0, 32.0), "ethiopia": (9.0, 39.5), "north korea": (40.0, 127.0),
    "korea": (38.0, 127.5), "cambodia": (12.6, 105.0), "nigeria": (9.5, 8.0),
    "biafra": (6.0, 7.5), "ireland": (53.3, -8.0), "finland": (63.0, 26.0),
    "iran": (32.5, 54.0), "brazil": (-12.0, -50.0), "mozambique": (-18.0, 35.5),
    "malawi": (-13.0, 34.0), "zimbabwe": (-19.0, 30.0), "sudan": (15.0, 30.0),
    "somalia": (5.5, 46.0), "congo": (-3.0, 23.0), "vietnam": (16.0, 107.0),
    "indonesia": (-2.5, 118.0), "greece": (39.0, 22.0), "netherlands": (52.2, 5.5),
    "dutch": (52.2, 5.5), "poland": (52.0, 19.0), "germany": (51.0, 10.0),
    "rwanda": (-1.9, 29.9), "burundi": (-3.4, 29.9), "uganda": (1.0, 32.5),
    "tanzania": (-6.4, 34.9), "angola": (-12.3, 17.5), "mali": (17.0, -3.0),
    "niger": (17.6, 8.1), "chad": (15.4, 18.7), "burkina": (12.3, -1.6),
    "mauritania": (20.3, -10.3), "senegal": (14.5, -14.5), "gambia": (13.4, -15.3),
    "guinea": (10.4, -11.0), "sierra leone": (8.5, -11.8), "liberia": (6.4, -9.4),
    "kenya": (0.2, 37.9), "yemen": (15.5, 44.0), "afghanistan": (33.9, 67.7),
    "iraq": (33.0, 43.7), "syria": (35.0, 38.5), "lebanon": (33.9, 35.5),
    "venezuela": (7.0, -66.0), "mexico": (23.6, -102.5), "philippines": (12.9, 122.9),
    "papua": (-6.5, 145.3), "japan": (36.2, 138.3), "france": (46.6, 2.4),
    "egypt": (26.8, 30.8), "madagascar": (-19.0, 46.7), "zambia": (-13.1, 27.8),
    "lesotho": (-29.6, 28.2), "eritrea": (15.2, 39.8), "djibouti": (11.8, 42.6),
}


def geocode(name):
    low = name.lower()
    for kw, c in CENTROIDS.items():
        if kw in low:
            return c
    return None


def fetch_csv(url):
    txt = http_get(url, timeout=90)
    return list(csv.reader(io.StringIO(txt)))


def main():
    # --- world population ---
    rows = fetch_csv("https://ourworldindata.org/grapher/population.csv")
    header, body = rows[0], rows[1:]
    e_i = header.index("Entity")
    y_i = header.index("Year")
    p_i = next(i for i, h in enumerate(header) if "opulation" in h and "density" not in h.lower())
    pop = []
    for r in body:
        if r[e_i] == "World" and r[y_i] and r[p_i]:
            pop.append([int(r[y_i]), float(r[p_i])])
    pop.sort()
    print(f"world population points: {len(pop)} ({pop[0][0]} .. {pop[-1][0]})")
    save_json("world_population.json", pop)

    # --- famines (deaths per country-year; rows with deaths become events) ---
    rows = fetch_csv("https://ourworldindata.org/grapher/deaths-from-famines-by-country-and-year.csv")
    header, body = rows[0], rows[1:]
    cols = {h: i for i, h in enumerate(header)}
    e_i = cols["Entity"]
    y_i = cols["Year"]
    d_i = next((i for h, i in cols.items() if "eath" in h), None)
    famines = []
    unmatched = []
    for r in body:
        country = r[e_i]
        year = int(r[y_i]) if r[y_i] else None
        deaths = None
        if d_i is not None and r[d_i]:
            try:
                deaths = float(r[d_i])
            except ValueError:
                pass
        if year is None or not deaths or deaths < 1000:
            continue
        g = geocode(country)
        if not g:
            unmatched.append(country)
            continue
        famines.append({"title": f"Famine in {country}", "year": year,
                        "lat": g[0], "lon": g[1], "deaths": deaths})
    print(f"famines: {len(famines)} placed; unmatched: {sorted(set(unmatched))}")
    save_json("famines.json", famines)


if __name__ == "__main__":
    main()
