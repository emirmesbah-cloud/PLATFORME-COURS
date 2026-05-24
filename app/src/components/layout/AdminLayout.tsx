import { NavLink, useNavigate, Outlet, Link } from 'react-router-dom';
import { useState } from 'react';
import {
  LayoutDashboard, KeyRound, Users, BookOpen, Gift, Menu, X, ArrowLeft, LogOut,
  TrendingUp, Heart, Mail, Shield, AlertTriangle, GraduationCap,
} from 'lucide-react';
import { SentryErrorBoundary } from '@/lib/sentry';
import { useAuth } from '@/hooks/useAuth';
import { AurelLogo } from '@/components/features/AurelLogo';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/admin',           label: 'Vue globale', icon: LayoutDashboard, end: true },
  { to: '/admin/codes',     label: 'Codes',       icon: KeyRound },
  { to: '/admin/students',  label: 'Étudiants',   icon: Users },
  { to: '/admin/lessons',   label: 'Leçons',      icon: BookOpen },
  { to: '/admin/quiz',      label: 'Quiz',        icon: GraduationCap },
  { to: '/admin/bonus',     label: 'Bonus',       icon: Gift },
  { to: '/admin/analytics', label: 'Analytics',   icon: TrendingUp },
  { to: '/admin/feedback',  label: 'Avis',        icon: Heart },
  { to: '/admin/emails',    label: 'Emails',      icon: Mail },
  { to: '/admin/audit',     label: 'Audit',       icon: Shield },
];

export function AdminLayout() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function handleSignOut() { await signOut(); navigate('/login', { replace: true }); }

  return (
    // SHERLOCK R6 fix : safe-area top + bottom for iOS notch + home-bar.
    <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-30 border-b border-aurel-teal bg-aurel-dark text-white pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="flex items-center gap-1 text-xs text-slate-300 hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Espace étudiant
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <AurelLogo size="sm" withText={false} />
            <span className="text-sm font-semibold">Admin Panel</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSignOut} className="hidden md:flex btn-ghost text-white hover:bg-white/10">
              <LogOut className="h-4 w-4" />
            </button>
            {/* SHERLOCK R6 fix : aria-label + aria-expanded + 44px min target. */}
            <button
              type="button"
              aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={open}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-2 hover:bg-white/10 md:hidden"
              onClick={() => setOpen(!open)}
            >
              {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 md:py-8">
        <aside className={cn('w-56 flex-shrink-0', open ? 'block' : 'hidden md:block')}>
          <nav className="sticky top-20 flex flex-col gap-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition',
                    isActive ? 'bg-aurel-teal text-white' : 'text-slate-700 hover:bg-slate-100'
                  )}
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <SentryErrorBoundary
            fallback={
              <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-6 text-center">
                <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
                <h2 className="mb-2 text-lg font-semibold text-aurel-ink">Une erreur est survenue</h2>
                <p className="mb-4 text-sm text-slate-600">Reviens à la vue globale ou réessaie.</p>
                <Link to="/admin" className="btn-primary">Vue globale</Link>
              </div>
            }
          >
            <Outlet />
          </SentryErrorBoundary>
        </main>
      </div>
    </div>
  );
}
