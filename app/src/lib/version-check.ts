// ============================================================================
// Version-check — Belt-and-suspenders cache busting cross-browser.
//
// Le SW (PWAUpdatePrompt) gère normalement les updates, mais Safari/Firefox
// ont parfois des bugs SW. Ce fichier ajoute une 2e ligne de défense :
// poll /version.json toutes les 60s + au focus/visibility, reload si changement.
// ============================================================================

declare const __BUILD_VERSION__: string;

// SHERLOCK R13 — B14: when the Service Worker is alive, PWAUpdatePrompt
// already polls /sw.js every 60s and auto-reloads on a new bundle. Polling
// /version.json on top of that doubles the network chatter AND races the SW
// update — both can fire location.reload() within the same second. We keep
// version-check as the FALLBACK for browsers where the SW is unsupported
// or blocked (some corporate Safari, FF private mode), and disable it
// otherwise.
const CHECK_INTERVAL_MS = 60_000;
let lastKnownServerVersion: string | null = null;
let reloading = false;
let started = false;

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
  if (lastKnownServerVersion === null) {
    lastKnownServerVersion = server;
    return;
  }
  if (server !== lastKnownServerVersion) {
    reloading = true;
    // eslint-disable-next-line no-console
    console.log('[VersionCheck] new version detected, reloading', {
      build: __BUILD_VERSION__,
      previousServer: lastKnownServerVersion,
      newServer: server,
    });
    setTimeout(() => location.reload(), 200);
  }
}

export function startVersionCheck(): () => void {
  // SHERLOCK R13 — B14: idempotency guard + SW-aware short-circuit.
  // If a SW is registered (PWAUpdatePrompt path), skip the duplicate poll.
  // We re-check after a small delay because the SW registers asynchronously.
  if (started) return () => {};
  started = true;

  const hasSW = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  if (hasSW) {
    // Wait a beat — if a controller shows up, the SW is alive and will
    // handle freshness; we stay quiet. Otherwise, fall through and poll.
    let cancelled = false;
    const fallbackTimer = window.setTimeout(() => {
      if (cancelled) return;
      if (navigator.serviceWorker.controller) return; // SW is handling it
      armPolling();
    }, 5000);
    return () => { cancelled = true; clearTimeout(fallbackTimer); disarm(); };
  }

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
