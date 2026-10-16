/**
 * Automated end-to-end verification of the human-spread build.
 * Split into independent phases, each in its own short-lived headless-Chrome
 * session (the renderer dies randomly under software WebGL; short sessions
 * dodge it). Every phase retries once on environmental crashes. Real app
 * failures are never retried away. Exit 0 = all green.
 * Usage: node verify/verify.mjs [url]
 */
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const URL = process.argv[2] || "http://localhost:4180/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ART = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "verify");
const POLL = { polling: 400, timeout: 25000 };
const ARGS = [
  "--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--window-size=1280,832",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function analyzePng(buf, cx0 = 0.3, cx1 = 0.7, cy0 = 0.2, cy1 = 0.75) {
  const png = PNG.sync.read(buf);
  const { width: w, height: h, data } = png;
  const x0 = Math.floor(w * cx0), x1 = Math.floor(w * cx1);
  const y0 = Math.floor(h * cy0), y1 = Math.floor(h * cy1);
  let lit = 0, total = 0, red = 0, gold = 0, purple = 0, orange = 0, warm = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      total++;
      if (r + g + b > 30) lit++;
      if (r > 140 && g < 110 && b < 110) red++;
      if (r > 170 && g > 120 && g < 210 && b < 130) gold++;
      if (r > 120 && b > 170 && g < 140) purple++;
      if (r > 185 && g > 85 && g < 195 && b < 95) orange++;
      if (r > 110 && r > g + 15 && g > b) warm++; // any warm-hued pixel
    }
  }
  return { litFrac: +(lit / total).toFixed(3), red, gold, purple, orange, warm };
}

async function withPage(fn) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, args: ARGS,
    defaultViewport: { width: 1280, height: 832 },
  });
  try {
    const page = await browser.newPage();
    page.on("error", (e) => { throw e; });
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
    await page.waitForSelector("#big-year", { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById("big-year")?.textContent === "1900 CE", POLL);
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function phase(name, fn) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const checks = [];
      const check = (n, ok, d = "") => checks.push({ name: n, ok, detail: d });
      await fn(check);
      return { name, checks };
    } catch (e) {
      const msg = String(e?.message || e);
      const env = /detached Frame|Target closed|Session closed|Page crashed|Protocol error|Waiting for selector .#big-year. failed/i.test(msg);
      console.error(`  [${name}] attempt ${attempt} ${env ? "environment crash" : "FAILURE"}: ${msg.slice(0, 110)}`);
      if (!env || attempt === 3) return { name, checks: [{ name: `${name} (phase error)`, ok: false, detail: msg.slice(0, 160) }] };
    }
  }
}

const phases = [];

/* ---------- phase 1: boot, painting, initial state ---------- */
phases.push(await phase("boot+paint", async (check) => {
  await withPage(async (page) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

    const stats = await page.evaluate(() => window.__hs?.stats());
    check("data loaded, full span -1467..2026",
      stats?.events > 30000 && stats?.years?.[0] === -1467 && stats?.years?.[1] === 2026,
      `${stats?.events} events`);

    await sleep(7000);
    const shot = await page.screenshot();
    fs.writeFileSync(path.join(ART, "verified-screenshot.png"), shot);
    const a = analyzePng(shot);
    check("globe paints with basemap + event markers",
      a.litFrac > 0.02 && a.red + a.gold > 150, JSON.stringify(a));

    const init = await page.evaluate(() => ({
      pop: document.getElementById("pop-line")?.textContent,
      active: document.getElementById("active-count")?.textContent,
      items: document.querySelectorAll(".stream-item").length,
      regions: document.querySelectorAll(".stream-region").length,
      ticks: document.querySelectorAll("#ticks .tick").length,
    }));
    check("population ticker (1900 ≈ 1.6 billion)", /1\.[4-8]\d* billion/.test(init.pop || ""), init.pop);
    check("globe event count > 400 (memory 20 default)", parseInt(init.active) > 400, init.active);
    check("stream populated (≥30 items, ≥5 regions)", init.items >= 30 && init.regions >= 5, `${init.items} items / ${init.regions} regions`);
    const g = await page.evaluate(() => {
      const a = document.querySelector(".stream-item .g-link");
      return a ? a.getAttribute("href") : null;
    });
    check("stream items carry Google search links",
      !!g && g.startsWith("https://www.google.com/search?q=") && decodeURIComponent(g).length > 30, g?.slice(0, 80) ?? "none");
    check("timeline era ticks rendered", init.ticks >= 6, init.ticks + " ticks");
    const realErrors = errors.filter((e) => !/favicon/.test(e));
    check("clean load (no page/console errors)", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || "clean");
  });
}));

/* ---------- phase 2: playback + timeline navigation ---------- */
phases.push(await phase("timeline", async (check) => {
  await withPage(async (page) => {
    await page.evaluate(() => document.getElementById("t-play").click());
    let yearDuringPlay = "1900 CE";
    for (let i = 0; i < 14; i++) {
      await sleep(1000);
      yearDuringPlay = await page.evaluate(() => document.getElementById("big-year")?.textContent);
      if (yearDuringPlay !== "1900 CE") break;
    }
    check("playback advances the year", yearDuringPlay !== "1900 CE", "reached " + yearDuringPlay);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true })));
    await sleep(300);
    const pausedYear = await page.evaluate(() => document.getElementById("big-year")?.textContent);
    await sleep(1500);
    const stillYear = await page.evaluate(() => document.getElementById("big-year")?.textContent);
    check("pause holds the year", stillYear === pausedYear, `${pausedYear} held`);

    await page.evaluate(() => document.querySelector("#era-presets button").click());
    await page.waitForFunction(() => /BCE/.test(document.getElementById("big-year")?.textContent || ""), POLL);
    const ancient = await page.evaluate(() => ({
      year: document.getElementById("big-year")?.textContent,
      items: document.querySelectorAll(".stream-item").length,
    }));
    check("era jump to 1468 BCE", /146[678] BCE/.test(ancient.year || ""), `${ancient.year} · ${ancient.items} stream events`);

    await page.evaluate(() => {
      document.getElementById("jump-year").value = "1815";
      document.querySelector("#jump-form button").click();
    });
    await page.waitForFunction(() => document.getElementById("big-year")?.textContent === "1815 CE", POLL);
    const y1815 = await page.evaluate(() => [...document.querySelectorAll(".stream-item-title")].slice(0, 12).map((e) => e.textContent));
    check("jump to 1815 surfaces Waterloo", y1815.some((t) => /Waterloo/i.test(t)), y1815.slice(0, 3).join("; "));

    await page.evaluate(() => {
      const s = document.getElementById("slider");
      s.value = 0;
      s.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const scrubA = await page.evaluate(() => document.getElementById("big-year")?.textContent);
    check("slider scrub to start (BCE)", /BCE/.test(scrubA || ""), scrubA);
    await page.evaluate(() => {
      const s = document.getElementById("slider");
      s.value = 1000;
      s.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const scrubB = await page.evaluate(() => document.getElementById("big-year")?.textContent);
    check("slider scrub to end (2026)", /202\d CE/.test(scrubB || ""), scrubB);

    await page.evaluate(() => window.__hs.setYear(1943));
    await sleep(500);
    const before = parseInt(await page.evaluate(() => document.getElementById("active-count")?.textContent));
    await page.evaluate(() => {
      const m = document.getElementById("memory");
      m.value = 40;
      m.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(500);
    const after = parseInt(await page.evaluate(() => document.getElementById("active-count")?.textContent));
    check("memory slider increases visible events", after > before, `${before} → ${after}`);
  });
}));

/* ---------- phase 3: layers + interactions ---------- */
phases.push(await phase("interactions", async (check) => {
  await withPage(async (page) => {
    await page.evaluate(() => document.querySelector("#cat-list .cat-row .solo").click());
    let soloCounts = [];
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      soloCounts = await page.evaluate(() => [...document.querySelectorAll("#cat-list .cat-row")].map((r) => r.querySelector(".count")?.textContent));
      if (soloCounts.filter((c) => c !== "0").length === 1) break;
    }
    check("solo mode shows exactly one category", soloCounts.filter((c) => c !== "0").length === 1, JSON.stringify(soloCounts));
    await page.evaluate(() => document.getElementById("all-cats").click());
    await sleep(500);
    const restored = await page.evaluate(() => [...document.querySelectorAll("#cat-list .cat-row")].filter((r) => r.querySelector(".count")?.textContent !== "0").length);
    check("show-all restores categories (4 carry events in 1939)", restored >= 4, restored + " active");
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll("#cat-list .cat-row")].find((r) => r.textContent.includes("Eclipses")).querySelector("input");
      cb.click();
    });
    await sleep(500);
    const eclipseCount = await page.evaluate(() => [...document.querySelectorAll("#cat-list .cat-row")].find((r) => r.textContent.includes("Eclipses")).querySelector(".count")?.textContent);
    check("category toggle zeroes its count", eclipseCount === "0", "eclipses: " + eclipseCount);

    await page.evaluate(() => {
      window.__hs.setYear(1940);
      const m = window.__hs.map;
      m.setZoom(6);
      m.setCenter([4.4, 50.8]);
    });
    await sleep(2500);
    const clicked = await page.evaluate(() => {
      const m = window.__hs.map;
      const feats = m.queryRenderedFeatures({ layers: ["event-point", "event-labels"] });
      if (!feats.length) return { ok: false, reason: "no rendered features" };
      const p = m.project(feats[0].geometry.coordinates);
      const el = document.elementFromPoint(p.x, p.y) || document.querySelector(".maplibregl-canvas");
      el.dispatchEvent(new MouseEvent("click", { clientX: p.x, clientY: p.y, bubbles: true }));
      return { ok: true, title: feats[0].properties?.t };
    });
    await sleep(900);
    const popup = await page.evaluate(() => ({
      title: document.querySelector(".maplibregl-popup .pop-title")?.textContent,
      hasSrc: !!document.querySelector(".maplibregl-popup .pop-meta a"),
    }));
    check("event click opens popup with source link",
      clicked.ok && !!popup.title && popup.hasSrc,
      clicked.ok ? `"${popup.title}" (clicked "${clicked.title}")` : clicked.reason);
    const glink = await page.evaluate(() => !!document.querySelector('.maplibregl-popup .pop-meta a[href^="https://www.google.com/search"]'));
    check("popup offers learn-more Google link", glink, "");

    await page.evaluate(() => document.querySelector(".maplibregl-popup-close-button")?.click());
    const itemIdx = await page.evaluate(() => {
      const item = document.querySelector(".stream-item");
      item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return item?.dataset.i;
    });
    await sleep(1800);
    const zoom = await page.evaluate(() => window.__hs.map.getZoom());
    check("stream item click zooms into location", zoom > 3, `zoom ${zoom.toFixed(1)} (item ${itemIdx})`);
  });
}));


/* ---------- phase 4: population layer ---------- */
phases.push(await phase("population", async (check) => {
  await withPage(async (page) => {
    const pg = await page.evaluate(async () => {
      const r = await fetch("data/popgrid.json");
      return { status: r.status, d: r.ok ? await r.json() : null };
    });
    check("popgrid.json loads (≥25 epochs)",
      pg.status === 200 && pg.d?.grids?.length >= 25,
      pg.d ? `${pg.d.grids.length} epochs, ${pg.d.w}x${pg.d.h}, max cell ${pg.d.maxCellPop}` : `HTTP ${pg.status}`);
    check("population source + raster layer on globe", await page.evaluate(() =>
      !!window.__hs.map.getSource("population") && !!window.__hs.map.getLayer("population-heat")));

    await page.evaluate(() => window.__hs.setYear(-1500));
    await sleep(700);
    const lenA = await page.evaluate(() => window.__hs.popImageLen());
    await page.evaluate(() => window.__hs.setYear(1349));
    await sleep(700);
    const lenB = await page.evaluate(() => window.__hs.popImageLen());
    await page.evaluate(() => window.__hs.setYear(2020));
    await sleep(700);
    const lenC = await page.evaluate(() => window.__hs.popImageLen());
    check("population raster changes across eras",
      lenA > 1000 && lenB > 1000 && (lenA !== lenB || lenB !== lenC),
      `dataURL sizes ${lenA}/${lenB}/${lenC}`);

    await page.evaluate(() => document.getElementById("pop-toggle").click());
    await sleep(400);
    const visOff = await page.evaluate(() => window.__hs.map.getLayoutProperty("population-heat", "visibility"));
    await page.evaluate(() => document.getElementById("pop-toggle").click());
    await sleep(400);
    const visOn = await page.evaluate(() => window.__hs.map.getLayoutProperty("population-heat", "visibility"));
    check("population toggle shows/hides layer", visOff === "none" && visOn === "visible", `${visOff} → ${visOn}`);

    await page.evaluate(() => window.__hs.setYear(1940));
    await sleep(2500);
    const on = analyzePng(await page.screenshot());
    await page.evaluate(() => document.getElementById("pop-toggle").click());
    await sleep(1500);
    const off = analyzePng(await page.screenshot());
    await page.evaluate(() => document.getElementById("pop-toggle").click());
    await sleep(800);
    check("population heat visible on globe", on.warm - off.warm > 5000,
      `warm px ${on.warm} → ${off.warm} with layer off`);

    // exact point probes via map.project: ocean points must carry no heat,
    // populated land points must — this measures alignment against the basemap itself
    await page.evaluate(() => window.__hs.setYear(1940));
    await sleep(2500);
    const pts = await page.evaluate(() => {
      const m = window.__hs.map;
      const targets = {
        atlantic: [-35, 28], indianOcean: [72, -22],
        ganges: [84, 26], europe: [12, 50],
      };
      const out = {};
      for (const [k, ll] of Object.entries(targets)) {
        const p = m.project(ll);
        out[k] = { x: Math.round(p.x), y: Math.round(p.y) };
      }
      return out;
    });
    const png = PNG.sync.read(await page.screenshot());
    const { width: pw, data: pd } = png;
    const box = (x, y) => {
      let orange = 0, warm = 0, n = 0;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const i = ((y + dy) * pw + (x + dx)) * 4;
          if (i < 0 || i >= pd.length) continue;
          const r = pd[i], g = pd[i + 1], b = pd[i + 2];
          n++;
          if (r > 185 && g > 85 && g < 195 && b < 95) orange++;
          if (r > 110 && r > g + 15 && g > b) warm++;
        }
      }
      return { orange, warm, n };
    };
    const probe = Object.fromEntries(Object.entries(pts).map(([k, p]) => [k, box(p.x, p.y)]));
    check("no heat over open ocean",
      probe.atlantic.orange <= 2 && probe.indianOcean.orange <= 2,
      JSON.stringify(probe));
    check("heat hugs populated land", probe.ganges.warm >= 3 && probe.europe.warm >= 3,
      JSON.stringify(probe));

    await page.evaluate(() => {
      const m = document.getElementById("pop-opacity");
      m.value = "0.4";
      m.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(300);
    const op = await page.evaluate(() => window.__hs.map.getPaintProperty("population-heat", "raster-opacity"));
    check("opacity slider adjusts raster-opacity", Math.abs(op - 0.4) < 0.01, `opacity ${op}`);
  });
}));


/* ---------- report ---------- */
const all = phases.flatMap((p) => p.checks.map((c) => ({ phase: p.name, ...c })));
for (const r of all) console.log(`${r.ok ? "PASS" : "FAIL"}  [${r.phase}] ${r.name}${r.detail ? "  — " + r.detail : ""}`);
const failed = all.filter((r) => !r.ok);
console.log(`\n${all.length - failed.length}/${all.length} checks passed`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(" · "));
  process.exit(1);
}
