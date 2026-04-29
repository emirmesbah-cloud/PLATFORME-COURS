/**
 * KickedListener — écoute l'event global `aurel:kicked` émis par useAuth quand
 * la session courante est invalidée par un login depuis un autre appareil.
 * Affiche alors un toast d'info pour expliquer la déconnexion.
 *
 * Doit être monté à l'intérieur du ToastProvider.
 */

import { useEffect } from 'react';
import { useToast } from '@/components/ui/Toast';

export function KickedListener() {
  const { error } = useToast();

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ message: string }>).detail;
      const message =
        detail?.message ||
        'Vous avez été déconnecté car votre compte est utilisé sur un autre appareil.';
      error(message, 'Session expirée');
    }
    window.addEventListener('aurel:kicked', handler);
    return () => window.removeEventListener('aurel:kicked', handler);
  }, [error]);

  return null;
}
