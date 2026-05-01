// ============================================================================
// Version-check — Belt-and-suspenders cache busting cross-browser.
//
// Le SW (PWAUpdatePrompt) gère normalement les updates, mais Safari/Firefox
// ont parfois des bugs SW. Ce fichier ajoute une 2e ligne de défense :
// poll /version.json toutes les 60s + au focus/visibility, reload si changement.
// ============================================================================

declare const __BUILD_VERSION__: string;

const CHECK_INTERVAL_MS = 60_000;
let lastKnownServerVersion: string | null = null;
let reloading = false;

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
  checkAndReload();
  const intervalId = setInterval(checkAndReload, CHECK_INTERVAL_MS);
  const onVisibility = () => {
    if (document.visibilityState === 'visible') checkAndReload();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onFocus = () => checkAndReload();
  window.addEventListener('focus', onFocus);
  return () => {
    clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
  };
}
