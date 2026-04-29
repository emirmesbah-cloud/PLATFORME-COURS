/**
 * PWAUpdatePrompt — détecte qu'une nouvelle version du Service Worker est
 * disponible (push CI déployé pendant que l'utilisateur a l'app ouverte) et
 * propose un bouton "Mettre à jour" qui recharge proprement.
 *
 * Sans ça, l'utilisateur reste sur l'ancienne version tant qu'il ne ferme
 * pas / réouvre pas l'onglet — pas idéal pour une app où on push souvent.
 *
 * Auto-import via vite-plugin-pwa : le hook `useRegisterSW` est généré.
 */

import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function PWAUpdatePrompt() {
  const [showOfflineReady, setShowOfflineReady] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl) {
      // Periodic check : toutes les heures, demande au navigateur de re-fetch
      // le SW pour détecter une nouvelle version (Cloudflare a déployé entre-temps).
      // Sans ça, la détection ne se fait qu'au prochain hard reload.
      if (swUrl) {
        setInterval(async () => {
          try {
            const reg = await navigator.serviceWorker.getRegistration(swUrl);
            if (reg && !reg.installing) reg.update();
          } catch {}
        }, 60 * 60 * 1000); // 1h
      }
    },
    onRegisterError(error) {
      console.warn('[PWA] Service Worker registration error:', error);
    },
  });

  // Auto-hide le toast "offline ready" après 4s
  useEffect(() => {
    if (offlineReady) {
      setShowOfflineReady(true);
      const t = setTimeout(() => {
        setShowOfflineReady(false);
        setOfflineReady(false);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [offlineReady, setOfflineReady]);

  if (!needRefresh && !showOfflineReady) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl bg-aurel-ink px-4 py-3 text-white shadow-2xl max-w-[92vw]"
    >
      {needRefresh ? (
        <>
          <span className="text-sm">
            Une nouvelle version est disponible.
          </span>
          <button
            onClick={() => updateServiceWorker(true)}
            className="rounded-lg bg-aurel-orange px-3 py-1.5 text-sm font-semibold hover:bg-orange-600 transition"
          >
            Mettre à jour
          </button>
          <button
            onClick={() => setNeedRefresh(false)}
            aria-label="Ignorer"
            className="text-white/60 hover:text-white px-1"
          >
            ×
          </button>
        </>
      ) : (
        <span className="text-sm">
          ✅ App installée — chargement plus rapide
        </span>
      )}
    </div>
  );
}
