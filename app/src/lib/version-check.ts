// ============================================================================
// Version-check — Belt-and-suspenders cache busting cross-browser.
//
// Le SW (PWAUpdatePrompt) gère normalement les updates, mais Safari/Firefox
// ont parfois des bugs SW. Ce fichier ajoute une 2e ligne de défense :
// poll /version.json toutes les 60s + au focus/visibility, reload si changement.
// ============================================================================

declare const __BUILD_VERSION__: string;

// SHERLOCK R14 — H6 : flag global anti double-reload. Avant : si version-check
// et PWAUpdatePrompt ramassaient le même nouveau bundle dans la même fenêtre
// (rare mais possible quand le SW retombe en mode fallback), les deux
// firaient location.reload() back-to-back → loop infinie sur 1s avant que
// le browser ne short-circuit. Maintenant on flip un flag window-level
// avant tout reload. Exporté pour que PWAUpdatePrompt utilise le même.
declare global {
  interface Window { __aurelReloading?: boolean }
}
export function reloadOnce(): void {
  if (typeof window === 'undefined') return;
  if (window.__aurelReloading) return;
  window.__aurelReloading = true;
  window.location.reload();
}

const CHECK_INTERVAL_MS = 60_000;
let reloading = false;
let started = false;

function normalizedVersion(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 12) : '';
}

async function fetchServerVersion(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Cache-Control': 'no-cache, no-store' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.version ?? null;
  } catch {
    return null;
  }
}

async function checkAndReload(): Promise<void> {
  if (reloading) return;
  const server = await fetchServerVersion();
  if (!server) return;
  const serverVersion = normalizedVersion(server);
  const runningVersion = normalizedVersion(__BUILD_VERSION__);
  if (serverVersion && runningVersion && serverVersion !== runningVersion) {
    reloading = true;
    // eslint-disable-next-line no-console
    console.info('[VersionCheck] new version detected, reloading', {
      runningVersion,
      serverVersion,
    });

    // Safari can keep an obsolete PWA shell even after the origin/CDN cache
    // has been purged. Remove only this origin's CacheStorage entries and SW
    // registration before reloading; Supabase auth lives in localStorage and
    // is intentionally preserved.
    try {
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } catch {
      // Cache APIs are best-effort (private Safari can reject them). Reloading
      // still gives the browser a chance to fetch the current no-store HTML.
    }

    const freshUrl = new URL(window.location.href);
    freshUrl.searchParams.set('_aurel_version', serverVersion);
    window.__aurelReloading = true;
    window.location.replace(freshUrl.toString());
  }
}

export function startVersionCheck(): () => void {
  if (started) return () => {};
  started = true;
  // Always compare the running bundle with /version.json, including when a
  // service worker controls the page. This is the independent recovery path
  // for Safari/PWA update failures.
  armPolling();
  return disarm;
}

let intervalId: number | null = null;
let onVisibility: (() => void) | null = null;
let onFocus: (() => void) | null = null;

function armPolling() {
  checkAndReload();
  intervalId = window.setInterval(checkAndReload, CHECK_INTERVAL_MS);
  onVisibility = () => {
    if (document.visibilityState === 'visible') checkAndReload();
  };
  document.addEventListener('visibilitychange', onVisibility);
  onFocus = () => checkAndReload();
  window.addEventListener('focus', onFocus);
}

function disarm() {
  if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
  if (onVisibility) { document.removeEventListener('visibilitychange', onVisibility); onVisibility = null; }
  if (onFocus) { window.removeEventListener('focus', onFocus); onFocus = null; }
}
