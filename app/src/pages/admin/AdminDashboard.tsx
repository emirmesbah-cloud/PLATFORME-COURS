import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users, Activity, KeyRound, TrendingUp, Award, Loader2, ArrowRight,
  Wallet, Download, AlertTriangle,
} from 'lucide-react';
import {
  fetchAdminStats, fetchAccountingStats, fetchAdminPayments, queryKeys,
} from '@/lib/queries';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

/**
 * AdminDashboard — Linear Tech direction (palette Aurel).
 *
 * Layout :
 *   - Hero card actionnable (alert orange si paiements pending)
 *   - 4 KPI cards (étudiants / actifs / revenu mois / à compléter)
 *   - 2-col : table paiements récents + sidepanel (cumul, activité)
 */
export function AdminDashboard() {
  const statsQ = useQuery({ queryKey: queryKeys.adminStats,           queryFn: fetchAdminStats });
  const acctQ  = useQuery({ queryKey: queryKeys.adminAccountingStats, queryFn: fetchAccountingStats });
  const paymsQ = useQuery({
    queryKey: queryKeys.adminPayments({ recent: true }),
    queryFn: () => fetchAdminPayments({}),
    staleTime: 60 * 1000,
  });
  const { profile } = useAuth();
  const toast = useToast();

  const stats = statsQ.data;
  const acct  = acctQ.data;
  const payments = (paymsQ.data ?? []).slice(0, 6);

  // ── Certificate preview (legacy admin tool) ────────────────────────────
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function handleCertificatePreview() {
    if (!profile) {
      toast.error('Profile pas encore chargé. Patiente une seconde.', 'Erreur');
      return;
    }
    setPreviewLoading(true);
    try {
      const pdfMod = await import('@react-pdf/renderer').catch((e) => {
        throw new Error(`Chargement du moteur PDF échoué : ${e?.message || e}`);
      });
      const certMod = await import('@/components/features/CertificatePDF').catch((e) => {
        throw new Error(`Chargement du template échoué : ${e?.message || e}`);
      });
      const todayIso = new Date().toISOString();
      const mockCert = {
        id: 'preview', user_id: profile.id,
        certificate_number: 'AUREL-2026-PREVIEW',
        issued_at: todayIso, pdf_url: null,
        full_name_on_certificate: `${profile.first_name} ${profile.last_name}`,
        course_completion_date: todayIso,
      };
      const blob = await pdfMod.pdf(<certMod.CertificatePDF certificate={mockCert} />).toBlob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        toast.info('Pop-up bloqué — téléchargement direct…', 'Info');
        const a = document.createElement('a');
        a.href = url;
        a.download = 'apercu-certificat-aurel-academy.pdf';
        document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      console.error('[certificate-preview]', e);
      toast.error(msg.slice(0, 120), 'Erreur génération PDF');
    } finally {
      setPreviewLoading(false);
    }
  }

  const pending = acct?.pending ?? 0;
  const revenueThisDA = acct?.this_month?.dzd ?? 0;

  return (
    <div className="space-y-6">

      {/* Top breadcrumb */}
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
          <span>Admin</span>
          <span className="mx-2 text-aurel-orange">/</span>
          <span className="text-zinc-900">Tableau de bord</span>
        </div>
        <div className="hidden md:flex items-center gap-2 font-mono text-[11px] text-zinc-500">
          <span className="rounded-card-sm bg-zinc-50 px-2.5 py-1">
            {new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
            <b className="text-zinc-900">{new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</b>
          </span>
        </div>
      </div>

      {/* ── HERO CARD ─────────────────────────────────────────────── */}
      <section className="card-hero">
        <div className="relative">
          <div className="eyebrow-orange mb-3 inline-flex items-center gap-2 rounded-pill bg-aurel-orange/10 px-3 py-1 font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-aurel-orange dot-pulse" />
            {pending > 0 ? `${pending} paiement${pending > 1 ? 's' : ''} en attente` : 'Tout est à jour'}
          </div>
          <h1 className="text-display tracking-tight text-zinc-950 max-w-3xl">
            {stats?.total_students ?? 0} étudiant{(stats?.total_students ?? 0) > 1 ? 's' : ''} actif{(stats?.total_students ?? 0) > 1 ? 's' : ''},{' '}
            <span className="text-aurel-orange">
              {pending > 0 ? `${pending} paiement${pending > 1 ? 's' : ''} à compléter` : 'comptabilité à jour'}.
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-600">
            Revenu enregistré ce mois : <b className="text-zinc-900 tabular">{formatMoney(revenueThisDA)} DA</b>.
            {pending > 0 && ' Termine de saisir les montants en attente pour avoir une compta à jour.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/admin/comptabilite" className="btn-primary btn-lg">
              {pending > 0 ? 'Compléter les paiements' : 'Voir la comptabilité'} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/admin/analytics" className="btn-outline btn-lg">
              Voir analytics
            </Link>
          </div>
        </div>
      </section>

      {/* ── KPI strip ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Users}
          label="Étudiants inscrits"
          value={stats?.total_students ?? '—'}
          dotColor="#F97316"
          delta="depuis le lancement"
        />
        <Kpi
          icon={Activity}
          label="Actifs (7 jours)"
          value={stats?.active_week ?? '—'}
          dotColor="#0D7377"
          delta={
            stats && stats.total_students > 0
              ? `${Math.round((stats.active_week / stats.total_students) * 100)}% taux d'engagement`
              : ''
          }
        />
        <Kpi
          icon={TrendingUp}
          label="Revenu mois en cours"
          value={`${formatMoney(revenueThisDA)}`}
          unit="DA"
          dotColor="#16A34A"
          delta={acct ? `${acct.this_month.count} paiement(s) enregistré(s)` : ''}
        />
        <Kpi
          icon={Wallet}
          label="À compléter"
          value={pending}
          dotColor="#EA580C"
          delta={pending > 0 ? 'paiements en attente' : 'Tout est à jour ✨'}
          alert={pending > 0}
        />
      </section>

      {statsQ.isError && (
        <div className="rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Les stats n'ont pas pu charger (réseau lent). Recharge la page pour réessayer.
        </div>
      )}

      {/* ── 2-col grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">

        {/* LEFT : recent payments */}
        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold tracking-tight">Paiements récents</h3>
            <Link
              to="/admin/comptabilite"
              className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-aurel-orange"
            >
              Tous →
            </Link>
          </div>

          {paymsQ.isLoading && payments.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-card-sm bg-zinc-50" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <div className="rounded-card-sm bg-zinc-50 p-6 text-center text-sm text-zinc-500">
              Aucun paiement encore. Génère des codes d'activation pour démarrer.
            </div>
          ) : (
            <div className="space-y-0 -mx-2">
              {payments.map((p) => {
                const isPending = p.status === 'pending';
                return (
                  <Link
                    key={p.id}
                    to="/admin/comptabilite"
                    className={cn(
                      'grid grid-cols-[80px_1fr_auto] gap-3 items-center px-2 py-3 rounded-card-sm transition-colors',
                      isPending ? 'hover:bg-aurel-orange-soft/40' : 'hover:bg-zinc-50',
                    )}
                  >
                    <div className="font-mono text-[11px] text-zinc-500 tabular">
                      {new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-zinc-900">
                        {p.profile?.first_name} {p.profile?.last_name}
                      </div>
                      <div className="font-mono text-[11px] text-zinc-500 truncate">
                        {p.activation_code?.code ?? '—'} · {p.tier === 'accompagne' ? 'Accompagné' : 'Autonome'}
                      </div>
                    </div>
                    <div className="text-right">
                      {isPending ? (
                        <span className="rounded-pill bg-aurel-orange-soft px-2.5 py-1 font-mono text-[10px] font-semibold text-aurel-orange-dark uppercase tracking-wider">
                          À compléter
                        </span>
                      ) : (
                        <span className="text-[15px] font-semibold tabular">
                          {p.amount != null
                            ? `${formatMoney(p.amount)} ${p.currency ?? 'DA'}`
                            : '—'}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* RIGHT : sidepanel */}
        <aside className="space-y-3">

          {/* Alert if pending */}
          {pending > 0 && (
            <div className="rounded-card border border-aurel-orange bg-aurel-orange-soft p-4">
              <div className="mb-2 flex items-center gap-2 text-aurel-orange-dark font-semibold text-[13px]">
                <AlertTriangle className="h-4 w-4" />
                Actions requises
              </div>
              <p className="mb-3 text-[12px] text-zinc-700 leading-relaxed">
                Tu as <b>{pending} paiement{pending > 1 ? 's' : ''}</b> en attente d'enregistrement.
                Sans montant + méthode, ils ne comptent pas dans tes stats.
              </p>
              <Link to="/admin/comptabilite" className="inline-flex items-center gap-1.5 border-b border-aurel-orange-dark font-mono text-[11px] font-semibold text-aurel-orange-dark uppercase tracking-wider hover:text-aurel-orange">
                Compléter maintenant →
              </Link>
            </div>
          )}

          {/* Cumul YTD */}
          <div className="card-dark">
            <div className="relative">
              <div className="eyebrow text-aurel-orange-soft mb-2">— Cumul {new Date().getFullYear()}</div>
              <div className="text-[40px] font-semibold tracking-tight tabular leading-none">
                {formatMoney(acct?.ytd?.dzd ?? 0)}
                <span className="text-white/50 text-[20px] ml-1">DA</span>
              </div>
              <div className="mt-2 text-[12px] text-white/80">
                {acct?.ytd?.count ?? 0} paiement{(acct?.ytd?.count ?? 0) > 1 ? 's' : ''} enregistré{(acct?.ytd?.count ?? 0) > 1 ? 's' : ''} depuis janvier.
              </div>
            </div>
          </div>

          {/* Codes générés */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-tight">
              <KeyRound className="h-4 w-4 text-aurel-orange" />
              Codes d'activation
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[24px] font-semibold tabular tracking-tight">
                {stats?.codes_used ?? '—'}
              </span>
              <span className="text-[14px] text-zinc-400 tabular">/ {stats?.codes_total ?? '—'}</span>
            </div>
            <div className="mt-1 text-[12px] text-zinc-600">
              {stats?.codes_available ?? '—'} disponibles
            </div>
            <Link to="/admin/codes" className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-aurel-orange hover:text-aurel-orange-dark">
              Générer des codes →
            </Link>
          </div>

          {/* Complétion moyenne (Linear Tech style mini KPI) */}
          <div className="card p-5">
            <div className="mb-3 text-[13px] font-semibold tracking-tight">Complétion moyenne</div>
            <div className="flex items-baseline gap-1">
              <span className="text-[28px] font-semibold tabular text-aurel-teal tracking-tight">
                {stats?.avg_completion ?? '—'}
              </span>
              <span className="text-[14px] text-zinc-400">%</span>
            </div>
            <div className="mt-1 text-[12px] text-zinc-600">
              Tous étudiants confondus.
            </div>
          </div>

          {/* Outils admin */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-tight">
              <Award className="h-4 w-4 text-aurel-teal" />
              Outils
            </div>
            <p className="mb-3 text-[12px] leading-relaxed text-zinc-600">
              Génère un PDF d'aperçu du certificat qui sera délivré aux étudiants.
            </p>
            <button
              onClick={handleCertificatePreview}
              disabled={previewLoading || !profile}
              className="btn-outline w-full justify-center"
            >
              {previewLoading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Génération…</>
                : <><Download className="h-3.5 w-3.5" /> Aperçu certificat</>}
            </button>
          </div>

        </aside>
      </div>

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function Kpi({ icon: Icon, label, value, unit, dotColor, delta, alert }: {
  icon: typeof Users;
  label: string;
  value: string | number;
  unit?: string;
  dotColor: string;
  delta?: string;
  alert?: boolean;
}) {
  return (
    <div className={cn('kpi relative', alert && 'border-aurel-orange/50')}>
      <div className="kpi-label">
        <span className="kpi-dot" style={{ background: dotColor }} />
        {label}
      </div>
      <div className={cn('kpi-value', alert && 'text-aurel-orange-dark')}>
        {value}
        {unit && <span className="kpi-sub ml-1">{unit}</span>}
      </div>
      {delta && <div className="kpi-delta">{delta}</div>}
      <Icon className="absolute top-5 right-5 h-4 w-4 text-zinc-300" />
    </div>
  );
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  // Convert to k for >= 1000, m for >= 1m
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000)    return `${Math.round(n / 1000)}k`;
  return new Intl.NumberFormat('fr-FR').format(n);
}
