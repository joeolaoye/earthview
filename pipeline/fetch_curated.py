"""Small hand-curated set of famous pre-1900 tsunamis & volcanic eruptions.

Dates/locations are well-established encyclopedic facts; entries are clearly
marked as curated in the source field. Pre-1900 hazards otherwise need NCEI
discovery work that is tracked as a follow-up.
"""

CURATED = [
    # --- tsunamis (pre-1900) ---
    ("tsunami", "Amorgos/Crete earthquake & tsunami (Eastern Mediterranean)", 365, 36.0, 25.5, None),
    ("tsunami", "Sanriku tsunami, Japan", 869, 39.0, 144.0, None),
    ("tsunami", "Java tsunami (Mount Krakatoa area predecessor)", 1604, -7.0, 110.0, None),
    ("tsunami", "Meio Nankai tsunami, Japan", 1498, 33.5, 135.5, None),
    ("tsunami", "Cascadia earthquake & tsunami (Pacific NW, N. America)", 1700, 45.5, -124.5, None),
    ("tsunami", "Lisbon earthquake & tsunami, Portugal", 1755, 38.5, -9.5, None),
    ("tsunami", "Krakatoa eruption tsunami, Indonesia", 1883, -6.1, 105.4, None),
    ("tsunami", "Arica (Peru–Chile) earthquake & tsunami", 1868, -18.5, -70.3, None),
    ("tsunami", "Valparaíso earthquake & tsunami, Chile", 1837, -33.0, -71.6, None),
    ("tsunami", "Ryukyu Islands tsunami, Japan", 1771, 24.8, 125.3, None),
    ("tsunami", "Messina earthquake & tsunami, Sicily", 1908, 38.2, 15.6, None),
    ("tsunami", "Kutch earthquake & tsunami, India", 1819, 23.6, 69.8, None),
    # --- tsunamis (1900+, famous) ---
    ("tsunami", "Unimak (Aleutian) earthquake & tsunami, Alaska", 1946, 53.4, -163.0, None),
    ("tsunami", "Kamchatka earthquake & tsunami, Russia", 1952, 52.6, 159.5, None),
    ("tsunami", "Valdivia earthquake & tsunami, Chile", 1960, -38.1, -73.5, None),
    ("tsunami", "Great Alaska earthquake & tsunami, Alaska", 1964, 61.0, -147.5, None),
    ("tsunami", "Papua New Guinea tsunami (Aitape)", 1998, -3.0, 142.0, None),
    ("tsunami", "Indian Ocean earthquake & tsunami (Sumatra–Andaman)", 2004, 3.3, 95.8, None),
    ("tsunami", "Tōhoku earthquake & tsunami, Japan", 2011, 38.3, 142.4, None),
    ("tsunami", "Anak Krakatau flank collapse tsunami, Indonesia", 2018, -6.1, 105.4, None),
    ("tsunami", "Hunga Tonga–Hunga Haʻapai eruption tsunami", 2022, -20.5, -175.4, None),
    # --- volcanic eruptions (pre-1900, within 1468 BCE -> 1900) ---
    ("volcano", "Vesuvius eruption (buried Pompeii), Italy", 79, 40.75, 14.49, 5),
    ("volcano", "Ilopango eruption, El Salvador", 431, 13.75, -89.05, 6),
    ("volcano", "Paektu eruption, China/Korea", 946, 41.98, 128.08, 7),
    ("volcano", "Eldgjá eruption, Iceland", 939, 63.98, -17.53, 5),
    ("volcano", "Samalas (Rinjani) eruption, Indonesia", 1257, -8.41, 116.47, 7),
    ("volcano", "Kuwae eruption, Vanuatu", 1452, -16.83, 168.54, 6),
    ("volcano", "Huaynaputina eruption, Peru", 1600, -16.61, -70.85, 6),
    ("volcano", "Vesuvius eruption, Italy", 1631, 40.82, 14.43, 5),
    ("volcano", "Tseax Cone eruption, Canada", 1707, 55.12, -128.9, 4),
    ("volcano", "Laki (Skaftáreldar) eruption, Iceland", 1783, 64.07, -18.23, 6),
    ("volcano", "Tambora eruption, Indonesia", 1815, -8.25, 118.0, 7),
    ("volcano", "Galunggung eruption, Indonesia", 1822, -7.25, 108.06, 5),
    ("volcano", "Krakatoa eruption, Indonesia", 1883, -6.10, 105.42, 6),
    ("volcano", "Santa María eruption, Guatemala", 1902, 14.76, -91.55, 6),
    ("volcano", "Tarawera eruption, New Zealand", 1886, -38.23, 176.5, 5),
    ("volcano", "Grímsvötn (Laki system) eruption, Iceland", 1873, 64.42, -17.33, 4),
    ("volcano", "Mauna Loa eruption, Hawai'i", 1859, 19.48, -155.61, 4),
    ("volcano", "Cotopaxi eruption, Ecuador", 1877, -0.68, -78.44, 5),
    ("volcano", "Etna eruption, Sicily", 1669, 37.75, 14.99, 4),
    ("volcano", "Unzen eruption, Japan", 1792, 32.76, 130.3, 5),
    ("volcano", "Papandayan eruption, Indonesia", 1772, -7.32, 107.73, 4),
    ("volcano", "Nabro-area eruption, Eritrea/Ethiopia", 1460, 13.37, 41.7, 4),
]

SRC = "curated (see repository README; cross-check NCEI/Wikipedia)"


def main():
    from fetch_common import save_json

    tsunamis, volcanoes = [], []
    for cat, title, year, lat, lon, vei in CURATED:
        rec = {"title": title, "year": year, "lat": lat, "lon": lon,
               "mag": (min(1.0, (vei - 2) / 6.0) if vei else None), "src": SRC}
        if cat == "tsunami":
            rec["mag"] = None
            tsunamis.append(rec)
        else:
            volcanoes.append(rec)
    print(f"curated tsunamis: {len(tsunamis)}, volcanoes: {len(volcanoes)}")
    save_json("curated_tsunamis.json", tsunamis)
    save_json("curated_volcanoes.json", volcanoes)


if __name__ == "__main__":
    main()
