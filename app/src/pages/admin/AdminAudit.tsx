import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, Search } from 'lucide-react';
import { fetchAuditLogs, queryKeys } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';
import { formatDateTime, cn } from '@/lib/utils';

const ACTION_LABEL: Record<string, { label: string; color: string }> = {
  code_generated:        { label: 'Code généré',           color: 'badge-orange' },
  code_revoked:          { label: 'Code révoqué',          color: 'badge-red' },
  lesson_published:      { label: 'Leçon publiée',         color: 'badge-green' },
  lesson_unpublished:    { label: 'Leçon retirée',         color: 'badge-slate' },
  bonus_uploaded:        { label: 'Bonus uploadé',         color: 'badge-orange' },
  bonus_published:       { label: 'Bonus publié',          color: 'badge-green' },
  student_profile_modified: { label: 'Profil modifié',     color: 'badge-teal' },
  feedback_updated:      { label: 'Avis modéré',           color: 'badge-teal' },
  feedback_approved:     { label: 'Avis approuvé',         color: 'badge-green' },
  feedback_rejected:     { label: 'Avis rejeté',           color: 'badge-red' },
  webinar_group_updated: { label: 'Groupe webinar modifié', color: 'badge-orange' },
};

export function AdminAudit() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.adminAudit,
    queryFn: () => fetchAuditLogs({ limit: 500 }),
  });

  const filtered = useMemo(() => {
    const all = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((l) => (
      l.action_type.toLowerCase().includes(q) ||
      (l.target_type ?? '').toLowerCase().includes(q) ||
      (l.target_id ?? '').toLowerCase().includes(q) ||
      JSON.stringify(l.metadata ?? {}).toLowerCase().includes(q)
    ));
  }, [data, search]);

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-teal">
          <Shield className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Audit trail</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink">Journal des actions admin</h1>
        <p className="mt-1 text-slate-600">Toutes les actions sensibles effectuées dans le panel admin sont tracées ici.</p>
      </header>

      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-600">
            <strong className="text-aurel-ink">{filtered.length}</strong> action{filtered.length > 1 ? 's' : ''}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input w-72 pl-9" placeholder="Rechercher action / target / metadata..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Chargement..." />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Aucune action enregistrée.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Cible</th>
                  <th className="px-4 py-3">Métadonnées</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((l) => {
                  const meta = ACTION_LABEL[l.action_type] ?? { label: l.action_type, color: 'badge-slate' };
                  return (
                    <tr key={l.id} className="hover:bg-slate-50 align-top">
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className={cn('badge', meta.color)}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        {l.target_type ? (
                          <div>
                            <div className="text-xs text-slate-400 uppercase">{l.target_type}</div>
                            <div className="font-mono text-xs text-slate-600 truncate max-w-[200px]">{l.target_id}</div>
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {l.metadata ? (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-aurel-teal hover:underline">Voir</summary>
                            <pre className="mt-2 rounded bg-slate-50 p-2 text-[11px] text-slate-600 max-w-md overflow-auto">{JSON.stringify(l.metadata, null, 2)}</pre>
                          </details>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
