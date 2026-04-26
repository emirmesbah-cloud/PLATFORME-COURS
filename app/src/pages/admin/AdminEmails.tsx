import { useQuery } from '@tanstack/react-query';
import { Mail, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { fetchEmailLogs, queryKeys } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';
import { formatDateTime, cn } from '@/lib/utils';

const TYPE_LABEL: Record<string, string> = {
  welcome:                 'Bienvenue',
  reminder_inactive:       'Rappel inactivité 7j',
  milestone_50:            'Cap 50% atteint',
  certificate_issued:      'Certificat émis',
  feedback_request:        'Demande feedback',
};

export function AdminEmails() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.adminEmails,
    queryFn:  () => fetchEmailLogs({ limit: 200 }),
  });

  if (isLoading) return <Spinner label="Chargement..." />;
  const logs = data ?? [];

  const sent   = logs.filter((l) => l.status === 'sent').length;
  const failed = logs.filter((l) => l.status === 'failed').length;

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <Mail className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Emails transactionnels</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink">Logs d'envoi</h1>
        <p className="mt-1 text-slate-600">Trace de tous les emails envoyés via Resend (welcome, rappels, certificats…).</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat icon={CheckCircle2} label="Envoyés" value={sent} color="green" />
        <Stat icon={XCircle}      label="Échecs" value={failed} color="red" />
        <Stat icon={Mail}         label="Total"  value={logs.length} color="orange" />
      </div>

      <div className="card overflow-x-auto">
        {logs.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            Aucun email envoyé pour l'instant. Configure Resend (voir README) pour activer les emails transactionnels.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Destinataire</th>
                <th className="px-4 py-3">Sujet</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(l.sent_at)}</td>
                  <td className="px-4 py-3">
                    <span className="badge badge-orange">{TYPE_LABEL[l.email_type] || l.email_type}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{l.recipient_email}</td>
                  <td className="px-4 py-3 text-slate-600 truncate max-w-xs">{l.subject}</td>
                  <td className="px-4 py-3">
                    {l.status === 'sent' && <span className="badge badge-green">Envoyé</span>}
                    {l.status === 'failed' && <span className="badge badge-red" title={l.error_message ?? ''}>Échec</span>}
                    {l.status === 'pending' && <span className="badge badge-slate"><Clock className="h-3 w-3" /> En attente</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, color }: {
  icon: typeof Mail; label: string; value: number; color: 'green' | 'red' | 'orange';
}) {
  const colors = {
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    orange: 'bg-aurel-orange-soft text-aurel-orange-dark',
  }[color];
  return (
    <div className="card-padded">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-md', colors)}><Icon className="h-4 w-4" /></div>
      </div>
      <div className="text-2xl font-bold text-aurel-ink">{value}</div>
    </div>
  );
}
