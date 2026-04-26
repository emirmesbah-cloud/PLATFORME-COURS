import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Award, Download, Lock, Loader2, ArrowRight } from 'lucide-react';
import { fetchUserCertificate, fetchProgressSummary, queryKeys, rpcCheckAndIssueCertificate } from '@/lib/queries';
import { useAuth } from '@/hooks/useAuth';
import { Spinner } from '@/components/ui/Spinner';
import { ProgressBar } from '@/components/ui/Progress';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';

export function StudentCertificate() {
  const { user } = useAuth();
  const uid = user?.id ?? '';
  const toast = useToast();

  const [generating, setGenerating] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const certQ = useQuery({
    queryKey: queryKeys.certificate(uid),
    queryFn:  () => fetchUserCertificate(uid),
    enabled:  !!uid,
  });
  const summaryQ = useQuery({
    queryKey: queryKeys.progressSummary(uid),
    queryFn:  fetchProgressSummary,
    enabled:  !!uid,
  });

  // Try to issue certificate when user lands on the page (in case trigger missed it)
  useEffect(() => {
    if (!uid) return;
    if (certQ.data) return;
    rpcCheckAndIssueCertificate().then((res) => {
      if (res.ok && res.created) {
        certQ.refetch();
        toast.success('Certificat émis avec succès !', '🏆 Félicitations !');
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  async function handleGeneratePdf() {
    if (!certQ.data) return;
    setGenerating(true);
    try {
      const { pdf } = await import('@react-pdf/renderer');
      const { CertificatePDF } = await import('@/components/features/CertificatePDF');
      const blob = await pdf(<CertificatePDF certificate={certQ.data} />).toBlob();
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl(url);
      setPreviewing(true);
    } catch (err) {
      toast.error('Erreur lors de la génération du PDF.', 'Erreur');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownload() {
    if (!pdfBlobUrl) {
      await handleGeneratePdf();
      // wait until next render to use blob
      setTimeout(() => triggerDownload(), 100);
      return;
    }
    triggerDownload();
  }

  function triggerDownload() {
    if (!pdfBlobUrl || !certQ.data) return;
    const a = document.createElement('a');
    a.href = pdfBlobUrl;
    a.download = `certificat-aurel-academy-${certQ.data.certificate_number}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (certQ.isLoading || summaryQ.isLoading) return <Spinner label="Chargement..." />;

  const cert = certQ.data;
  const summary = summaryQ.data;

  // Si pas encore de certificat
  if (!cert) {
    const pct = summary?.percentage_complete ?? 0;
    const remaining = (summary?.total_lessons ?? 18) - (summary?.completed_lessons ?? 0);
    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <header className="text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-aurel-orange-soft">
            <Lock className="h-10 w-10 text-aurel-orange" />
          </div>
          <h1 className="text-3xl font-bold text-aurel-ink">Ton certificat n'est pas encore débloqué</h1>
          <p className="mt-2 text-slate-600">
            Termine les <strong>{summary?.total_lessons ?? 18} leçons</strong> pour recevoir ton certificat
            officiel <span className="font-serif italic">Deutsch für Pflegekräfte</span>.
          </p>
        </header>

        <section className="card-padded">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Ta progression</span>
            <span className="text-2xl font-bold text-aurel-orange">{pct}%</span>
          </div>
          <ProgressBar value={pct} color="orange" className="h-3" />
          <p className="mt-3 text-sm text-slate-500">
            {summary?.completed_lessons ?? 0} / {summary?.total_lessons ?? 18} leçons complétées —
            il te reste <strong>{remaining}</strong> leçon{remaining > 1 ? 's' : ''}.
          </p>
        </section>

        <Link to="/lecons" className="btn-primary btn-lg btn-block">
          Continuer mes leçons <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  // Certificat émis
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header className="text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-aurel-orange to-aurel-orange-dark shadow-lg shadow-aurel-orange/30">
          <Award className="h-10 w-10 text-white" />
        </div>
        <p className="text-sm font-semibold uppercase tracking-widest text-aurel-orange">Félicitations</p>
        <h1 className="mt-2 text-3xl font-bold text-aurel-ink md:text-4xl">
          Ton certificat <span className="font-serif italic">Aurel Academy</span> est prêt
        </h1>
        <p className="mt-2 text-slate-600">
          Tu as complété la formation Deutsch für Pflegekräfte. Voici ton certificat officiel.
        </p>
      </header>

      <section className="card-padded space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
          <Info label="Numéro" value={cert.certificate_number} />
          <Info label="Émis à" value={cert.full_name_on_certificate} />
          <Info label="Date complétion" value={formatDate(cert.course_completion_date)} />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button onClick={handleDownload} disabled={generating} className="btn-primary btn-lg">
            {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            Télécharger le PDF
          </button>
          {!previewing && (
            <button onClick={handleGeneratePdf} disabled={generating} className="btn-outline btn-lg">
              Voir un aperçu
            </button>
          )}
        </div>
      </section>

      {previewing && pdfBlobUrl && (
        <section className="card overflow-hidden">
          <iframe src={pdfBlobUrl} title="Certificat" className="w-full" style={{ height: 600 }} />
        </section>
      )}

      {/* Feedback CTA */}
      <section className="card-padded bg-gradient-to-br from-teal-50 to-white">
        <h3 className="mb-1 text-lg font-bold text-aurel-teal">Une dernière chose</h3>
        <p className="mb-4 text-sm text-slate-600">
          Ton retour aide les futurs apprenants à choisir Aurel Academy. Ça prend 2 minutes.
        </p>
        <Link to="/feedback" className="btn-secondary">Donner mon avis</Link>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-bold text-aurel-ink">{value}</div>
    </div>
  );
}
