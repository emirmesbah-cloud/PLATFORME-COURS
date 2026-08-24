import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { loadMetaPixel, META_CONSENT_KEY, trackEvent } from '@/lib/pixel';

const TRACKED_PUBLIC_PATHS = new Set(['/activate', '/inscription-webinar']);

/**
 * Consent is requested only on public acquisition pages. The student and admin
 * applications neither load the Meta SDK nor emit PageView events.
 */
export function MetaPixelConsent() {
  const { pathname } = useLocation();
  const eligible = TRACKED_PUBLIC_PATHS.has(pathname);
  const [choice, setChoice] = useState<'granted' | 'denied' | null>(() => {
    const saved = localStorage.getItem(META_CONSENT_KEY);
    return saved === 'granted' || saved === 'denied' ? saved : null;
  });

  useEffect(() => {
    if (!eligible || choice !== 'granted') return;
    loadMetaPixel();
    trackEvent('PageView');
  }, [eligible, choice, pathname]);

  if (!eligible || choice !== null) return null;
  return (
    <aside className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-xl rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl" aria-label="Choix des cookies publicitaires">
      <p className="text-sm font-semibold text-zinc-900">Mesure publicitaire</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600">
        Autorises-tu Meta à mesurer cette visite ? Refuser ne bloque aucune fonctionnalité de la plateforme.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-outline px-3 py-2 text-xs" onClick={() => { localStorage.setItem(META_CONSENT_KEY, 'denied'); setChoice('denied'); }}>Refuser</button>
        <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={() => { localStorage.setItem(META_CONSENT_KEY, 'granted'); setChoice('granted'); }}>Autoriser</button>
      </div>
    </aside>
  );
}
