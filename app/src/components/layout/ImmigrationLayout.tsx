import { Link, useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { LogOut, AlertTriangle, Shield } from 'lucide-react';
import { SentryErrorBoundary } from '@/lib/sentry';
import { useAuth } from '@/hooks/useAuth';
import { AurelLogo } from '@/components/features/AurelLogo';
import { initials } from '@/lib/utils';

/**
 * ImmigrationLayout — minimal shell for the single-course Immigration space.
 * No Pflege nav (immigration students only see their course). Header = logo,
 * profile, sign-out. Admins get a small "Admin" shortcut back.
 */
export function ImmigrationLayout() {
  const { profile, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const boundaryKeyRef = useRef(0);
  const lastPathRef = useRef(location.pathname);
  if (lastPathRef.current !== location.pathname) {
    lastPathRef.current = location.pathname;
    boundaryKeyRef.current += 1;
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-white pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 md:px-6">
          <Link to="/immigration" className="flex items-center gap-2">
            <AurelLogo />
          </Link>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <Link
                to="/admin"
                className="hidden md:inline-flex items-center gap-1.5 rounded-card-sm px-3 py-2 text-[13px] font-medium text-aurel-teal hover:bg-aurel-teal-soft"
              >
                <Shield className="h-4 w-4" /> Admin
              </Link>
            )}
            {profile && (
              <div className="hidden items-center gap-2.5 md:flex">
                <div className="text-right leading-tight">
                  <div className="text-[13px] font-semibold text-zinc-900">{profile.first_name} {profile.last_name}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-aurel-orange">Immigration</div>
                </div>
                <div
                  className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #F97316, #0D7377)' }}
                >
                  {initials(profile.first_name, profile.last_name)}
                </div>
              </div>
            )}
            <button onClick={handleSignOut} className="btn-ghost" aria-label="Déconnexion">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-10">
        <SentryErrorBoundary
          key={boundaryKeyRef.current}
          fallback={
            <div className="rounded-card border border-red-200 bg-red-50 p-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-500" />
              <h2 className="text-display-sm tracking-tight text-zinc-900">Une erreur est survenue</h2>
              <p className="mt-2 text-sm text-zinc-600">Recharge la page ou reviens à l'accueil du cours.</p>
              <Link to="/immigration" className="btn-primary mt-4 inline-flex">Accueil du cours</Link>
            </div>
          }
        >
          <Outlet />
        </SentryErrorBoundary>
      </main>
    </div>
  );
}
