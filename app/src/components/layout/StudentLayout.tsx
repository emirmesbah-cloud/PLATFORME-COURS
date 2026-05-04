import { Link, NavLink, useNavigate, Outlet } from 'react-router-dom';
import { useState } from 'react';
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
  const [open, setOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    // SHERLOCK R3 fix : `replace` so back-button doesn't navigate to a
    // cached student dashboard render (info leak window).
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/dashboard"><AurelLogo /></Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition',
                    isActive ? 'bg-aurel-orange-soft text-aurel-orange-dark' : 'text-slate-600 hover:bg-slate-100 hover:text-aurel-ink'
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
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-aurel-teal text-white' : 'text-aurel-teal hover:bg-teal-50'
                )}
              >
                <Shield className="h-4 w-4" />
                Admin
              </NavLink>
            )}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-3 md:flex">
              <div className="text-right text-sm">
                <div className="font-semibold text-aurel-ink">{profile?.first_name} {profile?.last_name}</div>
                <div className="text-xs text-slate-500">{profile && tierLabel(profile.tier)}</div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-aurel-teal text-sm font-bold text-white">
                {initials(profile?.first_name, profile?.last_name)}
              </div>
              <button onClick={handleSignOut} className="btn-ghost" aria-label="Déconnexion">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
            <button className="rounded p-2 text-slate-600 hover:bg-slate-100 md:hidden" onClick={() => setOpen(!open)}>
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="border-t border-slate-200 bg-white md:hidden">
            <nav className="flex flex-col p-2">
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium',
                      isActive ? 'bg-aurel-orange-soft text-aurel-orange-dark' : 'text-slate-700 hover:bg-slate-100'
                    )}
                  >
                    <Icon className="h-4 w-4" /> {item.label}
                  </NavLink>
                );
              })}
              {isAdmin && (
                <NavLink to="/admin" onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-aurel-teal">
                  <Shield className="h-4 w-4" /> Admin
                </NavLink>
              )}
              <button onClick={handleSignOut} className="mt-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50">
                <LogOut className="h-4 w-4" /> Déconnexion
              </button>
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 md:py-10">
        {/* SHERLOCK R3 fix : per-layout ErrorBoundary. Avant, une erreur dans
            n'importe quel composant route blank l'app entière (header +
            sidebar disparus). Maintenant l'header reste affiché, le user
            peut naviguer hors de la page cassée. */}
        <SentryErrorBoundary
          fallback={
            <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
              <h2 className="mb-2 text-lg font-semibold text-aurel-ink">Une erreur est survenue sur cette page</h2>
              <p className="mb-4 text-sm text-slate-600">L'erreur a été signalée. Reviens à ton dashboard ou réessaie.</p>
              <Link to="/dashboard" className="btn-primary">Retour au dashboard</Link>
            </div>
          }
        >
          <Outlet />
        </SentryErrorBoundary>
      </main>
    </div>
  );
}
