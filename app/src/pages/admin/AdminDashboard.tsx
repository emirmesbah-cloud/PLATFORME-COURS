import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Activity, KeyRound, TrendingUp, Award, Loader2 } from 'lucide-react';
import { fetchAdminStats, queryKeys } from '@/lib/queries';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';

export function AdminDashboard() {
  const statsQ = useQuery({ queryKey: queryKeys.adminStats, queryFn: fetchAdminStats });
  const { profile } = useAuth();
  const toast = useToast();

  const data = statsQ.data;
  const ph = (val: string | number | null | undefined) =>
    statsQ.isLoading && val === undefined ? '—' : (val ?? '—');

  // ── Certificate preview ───────────────────────────────────────────────
  // Generates a mock PDF certificate using the current admin's name + a fake
  // completion date (today). Opens it in a new tab so admins can review the
  // visual design before students start completing the course.
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function handleCertificatePreview() {
    if (!profile) return;
    setPreviewLoading(true);
    try {
      const { pdf } = await import('@react-pdf/renderer');
      const { CertificatePDF } = await import('@/components/features/CertificatePDF');
      const todayIso = new Date().toISOString();
      const mockCert = {
        id: 'preview',
        user_id: profile.id,
        certificate_number: 'AUREL-2026-PREVIEW',
        issued_at: todayIso,
        pdf_url: null,
        full_name_on_certificate: `${profile.first_name} ${profile.last_name}`,
        course_completion_date: todayIso,
      };
      const blob = await pdf(<CertificatePDF certificate={mockCert} />).toBlob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      // Open in new tab so admin can see + zoom + download if they want.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('certificate preview failed', e);
      toast.error('Impossible de générer l\'aperçu. Réessaie.', 'Erreur');
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Vue globale</h1>
        <p className="mt-1 text-slate-600">Indicateurs clés de la plateforme.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Étudiants inscrits"
          value={ph(data?.total_students)}
          accent="orange"
        />
        <StatCard
          icon={Activity}
          label="Actifs (7 jours)"
          value={ph(data?.active_week)}
          accent="teal"
        />
        <StatCard
          icon={KeyRound}
          label="Codes générés"
          value={data ? `${data.codes_used} / ${data.codes_total}` : '—'}
          sub={data ? `${data.codes_available} disponibles` : undefined}
          accent="orange"
        />
        <StatCard
          icon={TrendingUp}
          label="Complétion moyenne"
          value={data ? `${data.avg_completion}%` : '—'}
          accent="teal"
        />
      </div>

      {statsQ.isError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Les stats n'ont pas pu charger (réseau lent). Recharge la page pour réessayer.
        </div>
      )}

      {/* Outils admin */}
      <section className="card-padded">
        <div className="mb-4 flex items-center gap-2">
          <Award className="h-5 w-5 text-aurel-orange" />
          <h2 className="text-lg font-bold text-aurel-ink">Outils admin</h2>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          Aperçu du certificat qui sera délivré aux étudiants lorsqu'ils complètent la formation.
        </p>
        <button
          onClick={handleCertificatePreview}
          disabled={previewLoading || !profile}
          className="btn-outline"
        >
          {previewLoading
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Génération…</>
            : <><Award className="h-4 w-4" /> Voir un exemple de certificat</>}
        </button>
        <p className="mt-2 text-xs text-slate-500">
          Le PDF s'ouvrira dans un nouvel onglet avec ton nom comme exemple.
        </p>
      </section>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent }: {
  icon: typeof Users; label: string; value: string | number; sub?: string;
  accent: 'orange' | 'teal';
}) {
  const colors = accent === 'orange' ? 'bg-aurel-orange-soft text-aurel-orange-dark' : 'bg-teal-50 text-aurel-teal';
  return (
    <div className="card-padded">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors}`}><Icon className="h-5 w-5" /></div>
      </div>
      <div className="text-3xl font-bold text-aurel-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
