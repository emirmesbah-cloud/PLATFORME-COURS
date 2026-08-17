import { NavLink, useNavigate, Outlet, Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, KeyRound, Users, BookOpen, Gift, Menu, X, ArrowLeft, LogOut,
  TrendingUp, Heart, Mail, Shield, AlertTriangle, GraduationCap, Wallet, Plane,
  MessageCircle, Truck, ClipboardList, UserRoundCheck, FilePenLine, LockKeyhole,
} from 'lucide-react';
import { SentryErrorBoundary } from '@/lib/sentry';
import { useAuth } from '@/hooks/useAuth';
import { fetchAccountingStats, queryKeys } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * AdminLayout — Linear Tech direction (palette Aurel).
 *
 * Sidebar :
 *   - Sticky 240px wide on desktop, drawer overlay on mobile.
 *   - Grouped sections : Vue / Contenu / Gestion.
 *   - Badge alert (orange) on Comptabilité if pending payments > 0.
 * Top bar : breadcrumb mono + time + sign-out icon.
 */
const NAV_GROUPS: { label: string; items: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; alertKey?: 'pending' }[] }[] = [
  {
    label: 'Vue d\'ensemble',
    items: [
      { to: '/admin',           label: 'Tableau de bord', icon: LayoutDashboard, end: true },
      { to: '/admin/students',  label: 'Étudiants',       icon: Users },
      { to: '/admin/codes',     label: 'Codes',           icon: KeyRound },
    ],
  },
  {
    label: 'Contenu',
    items: [
      { to: '/admin/lessons',             label: 'Leçons Pflege',      icon: BookOpen },
      { to: '/admin/immigration-lessons', label: 'Leçons Immigration', icon: Plane },
      { to: '/admin/quiz',                label: 'Quiz Pflege',        icon: GraduationCap },
      { to: '/admin/immigration-quiz',    label: 'Quiz Immigration',   icon: Plane },
      { to: '/admin/bonus',               label: 'Bonus',              icon: Gift },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { to: '/admin/prospects',     label: 'Prospects',    icon: ClipboardList },
      { to: '/admin/formulaire',    label: 'Formulaire',   icon: FilePenLine },
      { to: '/admin/closers',       label: 'Closers',      icon: UserRoundCheck },
      { to: '/admin/commandes',    label: 'Commandes',    icon: Truck },
      { to: '/admin/comptabilite', label: 'Comptabilité', icon: Wallet, alertKey: 'pending' },
      { to: '/admin/analytics',    label: 'Analytics',    icon: TrendingUp },
      { to: '/admin/feedback',     label: 'Avis',         icon: Heart },
      { to: '/admin/emails',       label: 'Emails',       icon: Mail },
      { to: '/admin/webinar-groups', label: 'Groupes webinar', icon: MessageCircle },
      { to: '/admin/audit',        label: 'Audit',        icon: Shield },
      { to: '/admin/security',     label: 'Sécurité',     icon: LockKeyhole },
    ],
  },
];

export function AdminLayout() {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Pull accounting stats once for the pending-payments badge in the sidebar.
  const statsQ = useQuery({
    queryKey: queryKeys.adminAccountingStats,
    queryFn:  fetchAccountingStats,
    staleTime: 60 * 1000,
    enabled: profile?.staff_role !== 'closer',
  });
  const pending = statsQ.data?.pending ?? 0;
  const isCloser = profile?.staff_role === 'closer';
  const permissionPath: Record<string, string> = { prospects: '/admin/prospects', formulaire: '/admin/formulaire', commandes: '/admin/commandes', codes: '/admin/codes' };
  const closerPaths = new Set(['/admin/security', ...(profile?.staff_permissions ?? []).map((permission) => permissionPath[permission]).filter(Boolean)]);
  const visibleGroups = isCloser
    ? [{ label: 'Accès attribués', items: NAV_GROUPS.flatMap((group) => group.items).filter((item) => closerPaths.has(item.to)) }]
    : NAV_GROUPS;

  async function handleSignOut() { await signOut(); navigate('/login', { replace: true }); }

  const initial = profile ? `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}` : 'A';

  return (
    <div className="min-h-screen bg-white pb-[env(safe-area-inset-bottom)]">

      {/* MOBILE topbar — drawer trigger */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white pt-[env(safe-area-inset-top)] md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={open}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-card-sm hover:bg-zinc-100"
            onClick={() => setOpen(!open)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link to="/admin" className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-card-sm bg-zinc-950 text-white text-[14px] font-bold">A</div>
            <span className="text-[15px] font-semibold tracking-tight">Aurel <span className="font-mono text-[10px] uppercase tracking-wider text-aurel-orange">admin</span></span>
          </Link>
          <button onClick={handleSignOut} aria-label="Déconnexion" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-card-sm hover:bg-zinc-100">
            <LogOut className="h-4 w-4 text-zinc-600" />
          </button>
        </div>
      </header>

      <div className="flex">

        {/* SIDEBAR — sticky 240px on desktop, drawer on mobile */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 w-60 bg-zinc-50 border-r border-zinc-200 transition-transform md:translate-x-0 md:sticky md:top-0 md:h-screen flex flex-col py-6 px-4',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {/* Brand */}
          <Link to="/admin" className="mb-4 flex items-center gap-2.5 px-3 pb-5 border-b border-zinc-200" onClick={() => setOpen(false)}>
            <div className="grid h-7 w-7 place-items-center rounded-card-sm bg-zinc-950 text-white text-[14px] font-bold">A</div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">Aurel</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-aurel-orange font-medium">admin</div>
            </div>
          </Link>

          {/* Nav groups */}
          <nav className="flex-1 flex flex-col gap-0.5 overflow-y-auto">
            {visibleGroups.map((group) => (
              <div key={group.label} className="mt-3 first:mt-0">
                <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-500 font-medium">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const showAlert = item.alertKey === 'pending' && pending > 0;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) => cn(
                        'flex items-center gap-2.5 rounded-card-sm px-3 py-2 text-[14px] font-medium transition-colors',
                        isActive
                          ? 'bg-zinc-950 text-white'
                          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
                      )}
                    >
                      <Icon className="h-4 w-4 flex-none" />
                      <span className="flex-1">{item.label}</span>
                      {showAlert && (
                        <span className="rounded-card-sm bg-aurel-orange-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-aurel-orange-dark">
                          {pending}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Bottom : user + actions */}
          <div className="mt-auto pt-3 border-t border-zinc-200 space-y-1">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 px-3 py-2 rounded-card-sm text-[12px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              onClick={() => setOpen(false)}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Aperçu étudiant Pflege
            </Link>
            <Link
              to="/immigration"
              className="flex items-center gap-2 px-3 py-2 rounded-card-sm text-[12px] font-medium text-aurel-orange-dark hover:bg-aurel-orange-soft"
              onClick={() => setOpen(false)}
            >
              <Plane className="h-3.5 w-3.5" /> Aperçu étudiant Immigration
            </Link>
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-card-sm">
              <div
                className="grid h-7 w-7 place-items-center rounded-full text-white text-[11px] font-semibold flex-none"
                style={{ background: 'linear-gradient(135deg, #F97316, #0D7377)' }}
              >
                {initial}
              </div>
              <div className="leading-tight flex-1 min-w-0">
                <div className="truncate text-[13px] font-medium text-zinc-900">
                  {profile?.first_name} {profile?.last_name}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-aurel-orange">
                  {isCloser ? 'closer' : 'admin'}
                </div>
              </div>
              <button onClick={handleSignOut} className="hidden md:inline-flex h-7 w-7 items-center justify-center rounded-card-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900" aria-label="Déconnexion">
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </aside>

        {/* Overlay derrière drawer mobile */}
        {open && (
          <button
            aria-label="Fermer le menu"
            className="fixed inset-0 z-30 bg-zinc-950/40 md:hidden"
            onClick={() => setOpen(false)}
          />
        )}

        {/* MAIN */}
        <main className="flex-1 min-w-0 px-6 py-6 md:px-10 md:py-8 max-w-7xl">
          <SentryErrorBoundary
            fallback={
              <div className="rounded-card border border-red-200 bg-red-50 p-6 text-center">
                <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-500" />
                <h2 className="text-display-sm tracking-tight text-zinc-900">Une erreur est survenue</h2>
                <p className="mt-2 text-sm text-zinc-600">Reviens à la vue globale ou réessaie.</p>
                <Link to="/admin" className="btn-primary mt-4 inline-flex">Vue globale</Link>
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
