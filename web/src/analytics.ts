/**
 * PostHog analytics — OFF until you add your project key.
 *
 * To enable: paste your key from PostHog (Project Settings → API Key) into
 * POSTHOG_KEY below, set POSTHOG_HOST to your region (us/eu) or self-host URL,
 * rebuild, and deploy. posthog-js is dynamically imported, so the tracker
 * costs zero bytes and makes zero requests while the key is empty.
 */
export const POSTHOG_KEY = "";
export const POSTHOG_HOST = "https://us.i.posthog.com";

/* eslint-disable @typescript-eslint/no-explicit-any */
let ph: any = null;

export async function initAnalytics(): Promise<void> {
  if (!POSTHOG_KEY) return;
  try {
    const mod = await import("posthog-js");
    ph = mod.default;
    ph.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: true,
      autocapture: true, // general clicks/engagement beyond the custom events
    });
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
