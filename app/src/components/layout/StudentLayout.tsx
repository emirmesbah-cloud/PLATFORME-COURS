import { Link, NavLink, useLocation, useNavigate, Outlet, Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { LayoutDashboard, BookOpen, Gift, User, LogOut, Menu, X, Shield, Award, AlertTriangle } from 'lucide-react';
import { SentryErrorBoundary } from '@/lib/sentry';
import { useAuth } from '@/hooks/useAuth';
import { AurelLogo } from '@/components/features/AurelLogo';
import { initials, tierLabel } from '@/lib/utils';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/dashboard',   label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/lecons',      label: 'Mes leçons', icon: BookOpen },
  { to: '/bonus',       label: 'Bonus',      icon: Gift },
  { to: '/certificat',  label: 'Certificat', icon: Award },
  { to: '/profil',      label: 'Profil',     icon: User },
];

export function StudentLayout() {
  const { profile, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // SHERLOCK R17 : auto-reset the ErrorBoundary when the route changes. Avant :
  // si une page errored, naviguer vers une autre route gardait l'error UI
  // affichée (l'ErrorBoundary state survit aux changements d'URL tant qu'on
  // n'appelle pas resetError). Maintenant : on bump une key sur le boundary
  // à chaque pathname change → React remount le boundary → fresh start.
  const boundaryKeyRef = useRef(0);
  const lastPathRef = useRef(location.pathname);
  if (lastPathRef.current !== location.pathname) {
    lastPathRef.current = location.pathname;
    boundaryKeyRef.current += 1;
  }
  // Auto-close mobile menu on navigation.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Single-course gating : a student who bought Immigration shouldn't land
  // on the Pflege space. Admins are exempt (they preview everything).
  if (!isAdmin && profile?.course_access === 'immigration') {
    if (location.pathname === '/profil') {
      return <Navigate to="/immigration/profil" replace />;
    }
    return <Navigate to="/immigration" replace />;
  }

  async function handleSignOut() {
    await signOut();
    // SHERLOCK R3 fix : `replace` so back-button doesn't navigate to a
    // cached student dashboard render (info leak window).
    navigate('/login', { replace: true });
  }

  return (
    // SHERLOCK R6 fix : pb-[env(safe-area-inset-bottom)] reserves space for
    // the iOS home-bar so bottom buttons aren't hidden in PWA standalone.
    // Linear Tech direction : bg-white throughout, zinc-200 hairlines.
    <div className="min-h-screen bg-white pb-[env(safe-area-inset-bottom)]">
      {/* pt-[env(safe-area-inset-top)] keeps header content out of the
          notch / dynamic island when status-bar-style is black-translucent. */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <Link to="/dashboard" className="flex-none"><AurelLogo /></Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2 rounded-card-sm px-3 py-2 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-zinc-950 text-white'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) => cn(
                  'ml-2 flex items-center gap-2 rounded-card-sm px-3 py-2 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-aurel-teal text-white'
                    : 'text-aurel-teal hover:bg-aurel-teal-soft'
                )}
              >
                <Shield className="h-4 w-4" />
                Admin
              </NavLink>
            )}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-3 md:flex">
              <div className="text-right text-sm leading-tight">
                <div className="font-semibold text-zinc-900">{profile?.first_name} {profile?.last_name}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-aurel-orange">{profile && tierLabel(profile.tier)}</div>
              </div>
              <div
                className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #F97316, #0D7377)' }}
              >
                {initials(profile?.first_name, profile?.last_name)}
              </div>
              <button onClick={handleSignOut} className="btn-ghost" aria-label="Déconnexion">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
            {/* SHERLOCK R6 fix : aria-label + aria-expanded + 44px min target. */}
            <button
              type="button"
              aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={open}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-card-sm p-2 text-zinc-600 hover:bg-zinc-100 md:hidden"
              onClick={() => setOpen(!open)}
            >
              {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="border-t border-zinc-200 bg-white md:hidden">
            {/* Profile block on top of mobile drawer */}
            {profile && (
              <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
                <div
                  className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white flex-none"
                  style={{ background: 'linear-gradient(135deg, #F97316, #0D7377)' }}
                >
                  {initials(profile.first_name, profile.last_name)}
                </div>
                <div className="leading-tight min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-zinc-900">{profile.first_name} {profile.last_name}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-aurel-orange">{tierLabel(profile.tier)}</div>
                </div>
              </div>
            )}
            <nav className="flex flex-col gap-0.5 p-2">
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 rounded-card-sm px-3 py-3 text-[14px] font-medium min-h-[44px]',
                      isActive ? 'bg-zinc-950 text-white' : 'text-zinc-700 hover:bg-zinc-100'
                    )}
                  >
                    <Icon className="h-4 w-4" /> {item.label}
                  </NavLink>
                );
              })}
              {isAdmin && (
                <NavLink to="/admin" onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-card-sm px-3 py-3 text-[14px] font-medium text-aurel-teal min-h-[44px]">
                  <Shield className="h-4 w-4" /> Admin
                </NavLink>
              )}
              <button onClick={handleSignOut} className="mt-1 flex items-center gap-3 rounded-card-sm px-3 py-3 text-[14px] font-medium text-red-600 hover:bg-red-50 min-h-[44px]">
                <LogOut className="h-4 w-4" /> Déconnexion
              </button>
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
        {/* SHERLOCK R3 fix : per-layout ErrorBoundary. Avant, une erreur dans
            n'importe quel composant route blank l'app entière (header +
            sidebar disparus). Maintenant l'header reste affiché, le user
            peut naviguer hors de la page cassée. */}
        <SentryErrorBoundary
          key={boundaryKeyRef.current}
          fallback={({ error, resetError, eventId }) => (
            <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
              <h2 className="mb-2 text-lg font-semibold text-aurel-ink">Une erreur est survenue sur cette page</h2>
              <p className="mb-4 text-sm text-slate-600">L'erreur a été signalée. Reviens à ton dashboard ou réessaie.</p>
              {/* Show actual error message for debugging — Sentry collects it too,
                  but having it visible immediately helps users + me when reporting
                  bugs. Wrapped in a details so it's not too in-your-face. */}
              <details className="mb-4 text-left">
                <summary className="cursor-pointer text-xs font-mono text-red-700 hover:underline">
                  Détails techniques
                </summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-3 text-left text-xs text-red-900 ring-1 ring-red-200">
                  {(error as Error | undefined)?.message || String(error)}
                  {(error as Error | undefined)?.stack ? '\n\n' + (error as Error).stack : ''}
                  {eventId ? '\n\nSentry event: ' + eventId : ''}
                </pre>
              </details>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button onClick={resetError} className="btn-outline">Réessayer</button>
                <Link to="/dashboard" className="btn-primary">Retour au dashboard</Link>
              </div>
            </div>
          )}
        >
          <Outlet />
        </SentryErrorBoundary>
      </main>
    </div>
  );
}
