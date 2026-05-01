/**
 * PWAUpdatePrompt — Silent auto-update strategy.
 *
 * STRATEGY: zero user friction. When a new bundle is deployed, we auto-update
 * the service worker AND auto-reload the page within seconds. The user never
 * sees a stale version.
 *
 * Triggers a check :
 *   - On mount (immediate)
 *   - Every 60 seconds while tab is open
 *   - On visibility change (user comes back to tab)
 *   - On window focus
 *
 * When new version detected:
 *   - Auto-applies the update (skipWaiting)
 *   - Auto-reloads the page (location.reload)
 *
 * No popup, no toast, no button. Just silent freshness.
 */

import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_INTERVAL_MS = 60_000; // 60s

export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!swUrl || !registration) return;

      const interval = setInterval(() => {
        if (!registration.installing) {
          registration.update().catch(() => {});
        }
      }, CHECK_INTERVAL_MS);

      const onVisibility = () => {
        if (document.visibilityState === 'visible' && !registration.installing) {
          registration.update().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', onVisibility);

      const onFocus = () => {
        if (!registration.installing) registration.update().catch(() => {});
      };
      window.addEventListener('focus', onFocus);

      return () => {
        clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('focus', onFocus);
      };
    },
    onRegisterError(error) {
      console.warn('[PWA] Service Worker registration error:', error);
    },
  });

  useEffect(() => {
    if (needRefresh) {
      setTimeout(() => {
        updateServiceWorker(true);
      }, 200);
    }
  }, [needRefresh, updateServiceWorker]);

  return null;
}
