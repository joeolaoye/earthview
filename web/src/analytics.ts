/**
 * PostHog analytics.
 *
 * The key comes from build-time env vars (never committed):
 *   web/.env.local  →  VITE_POSTHOG_KEY=phc_…   VITE_POSTHOG_HOST=https://us.i.posthog.com
 * `posthog-js` is dynamically imported, so without a key it costs zero bytes.
 * Localhost runs are excluded by default (keeps dev/test traffic out of the
 * dashboard); append ?ph=force to override.
 */
const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
const POSTHOG_KEY = env.VITE_POSTHOG_KEY ?? "";
const POSTHOG_HOST = env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

/* eslint-disable @typescript-eslint/no-explicit-any */
let ph: any = null;

function allowed(): boolean {
  if (!POSTHOG_KEY) return false;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const forced = new URLSearchParams(location.search).has("ph");
  return !local || forced;
}

export async function initAnalytics(): Promise<void> {
  if (!allowed()) return;
  try {
    const mod = await import("posthog-js");
    ph = mod.default;
    ph.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: true,
      autocapture: true, // general clicks/engagement beyond the custom events
    });
    // this PostHog project only captures identified users — assign a random,
    // persistent, non-personal visitor id so anonymous traffic still counts
    let vid: string | null = null;
    try {
      vid = localStorage.getItem("ev_visitor_id");
      if (!vid) {
        vid = crypto.randomUUID();
        localStorage.setItem("ev_visitor_id", vid);
      }
    } catch {
      vid = "anon-" + Math.random().toString(36).slice(2);
    }
    ph.identify(vid);
  } catch (e) {
    console.warn("analytics init failed:", e);
    ph = null;
  }
}

export function track(name: string, props?: Record<string, unknown>): void {
  try {
    ph?.capture(name, props);
  } catch {
    /* analytics must never break the app */
  }
}

export function analyticsEnabled(): boolean {
  return !!ph;
}
