import { Component, type ReactNode } from 'react';

/**
 * ChunkErrorBoundary — catches dynamic-import failures from React.lazy().
 *
 * SHERLOCK R5 fix : after a deploy, hashed chunk filenames change. A user
 * with a stale tab clicking on `/admin/codes` triggers a lazy import of
 * `AdminCodes-<old-hash>.js` which 404s on Cloudflare. React 18 propagates
 * the error to the nearest boundary — without this guard, users saw a
 * generic "Une erreur est survenue" via SentryLayoutErrorBoundary, with
 * no clear next step.
 *
 * Now : on detected ChunkLoadError, we auto-reload the page once. The
 * fresh load gets the new index.html with the new chunk hashes. If the
 * reload-loop guard hits (already tried in this session), we fall back
 * to a "Recharger" CTA instead of looping infinitely.
 */

interface State { hasError: boolean; reloaded: boolean }

const RELOAD_FLAG_KEY = 'aurel:chunk-reloaded';

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as Error).message || String(err);
  const name = (err as Error).name || '';
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

export class ChunkErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, reloaded: false };

  static getDerivedStateFromError(error: Error): State | null {
    if (isChunkLoadError(error)) {
      return { hasError: true, reloaded: false };
    }
    return null;
  }

  componentDidCatch(error: Error) {
    if (!isChunkLoadError(error)) return;
    // Anti-loop : si on vient déjà de reload pour cette raison dans cette
    // session de tab, on ne reload PAS encore une fois — on affiche le CTA.
    let alreadyReloaded = false;
    try { alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG_KEY) === '1'; } catch {}
    if (alreadyReloaded) {
      this.setState({ hasError: true, reloaded: true });
      return;
    }
    try { sessionStorage.setItem(RELOAD_FLAG_KEY, '1'); } catch {}
    // eslint-disable-next-line no-console
    console.warn('[Aurel] ChunkLoadError detected, auto-reloading once', error);
    window.location.reload();
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (!this.state.reloaded) {
      // Auto-reload triggered — show a brief spinner-style hint while
      // location.reload() actually fires.
      return (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-sm text-slate-600">Mise à jour de l'application…</p>
        </div>
      );
    }
    return (
      <div className="m-6 rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
        <h2 className="mb-2 text-lg font-semibold text-aurel-ink">Nouvelle version disponible</h2>
        <p className="mb-4 text-sm text-slate-600">
          L'app a été mise à jour. Recharge la page pour voir la dernière version.
        </p>
        <button
          type="button"
          onClick={() => {
            try { sessionStorage.removeItem(RELOAD_FLAG_KEY); } catch {}
            window.location.reload();
          }}
          className="btn-primary"
        >
          Recharger
        </button>
      </div>
    );
  }
}
