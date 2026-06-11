import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Users, Download, MoreVertical, Ban, Trash2, X, BookOpen, Plane } from 'lucide-react';
import {
  fetchAllStudents, queryKeys, logAdminAction,
  rpcAdminRevokeUser, callAdminPurgeUser, rpcAdminSetCourseAccess,
} from '@/lib/queries';
import type { AdminStudentRow } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { tierLabel, formatDate, formatDateTime, initials, cn } from '@/lib/utils';

export function AdminStudents() {
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'autonome' | 'accompagne'>('all');
  // SHERLOCK R14 — H10 : toggle pour inclure les comptes révoqués dans la
  // liste. Par défaut OFF (le cas usuel = "voir mes étudiants actifs").
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  const { data: students, isLoading } = useQuery({
    queryKey: [...queryKeys.adminStudents, { includeRevoked }] as const,
    queryFn: () => fetchAllStudents({ includeRevoked }),
  });

  // SHERLOCK R14 — H9 : modals revoke + purge.
  const [revokeTarget, setRevokeTarget] = useState<AdminStudentRow | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  const [purgeTarget, setPurgeTarget] = useState<AdminStudentRow | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState('');
  const [purging, setPurging] = useState(false);

  // Kebab menu open state by row id (only one at a time).
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  function csvEscape(val: unknown): string {
    if (val === null || val === undefined) return '';
    let s = String(val);
    // SHERLOCK R13 — B1: neutralize CSV injection (formula-like leading chars).
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function handleExportCSV() {
    if (!students || students.length === 0) {
      toast.info('Aucun étudiant à exporter.');
      return;
    }
    const headers = ['id', 'email', 'first_name', 'last_name', 'whatsapp', 'tier', 'diplome_algerien', 'activated_at', 'last_login_at'];
    const rows = students.map((s) => headers.map((h) => csvEscape((s as never)[h])).join(','));
    const csv = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aurel-students-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    logAdminAction('students_exported_csv', null, null, { count: students.length });
    toast.success(`${students.length} étudiants exportés.`);
  }

  async function handleSetCourse(s: AdminStudentRow, course: 'pflege' | 'immigration') {
    setMenuOpenId(null);
    try {
      const r = await rpcAdminSetCourseAccess(s.id, course);
      if (!r.ok) {
        toast.error(r.error || 'Erreur inconnue.', 'Changement impossible');
        return;
      }
      const label = course === 'immigration' ? 'Immigration' : 'Pflege';
      toast.success(`${s.first_name} ${s.last_name} → cours ${label}.`);
      qc.invalidateQueries({ queryKey: queryKeys.adminStudents });
    } catch (e) {
      toast.error((e as Error).message ?? 'Erreur réseau.', 'Erreur');
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    const reason = revokeReason.trim();
    if (!reason) {
      toast.error('Indique une raison pour la révocation.', 'Raison requise');
      return;
    }
    setRevoking(true);
    try {
      const r = await rpcAdminRevokeUser(revokeTarget.id, reason);
      if (!r.ok) {
        toast.error(r.error || 'Erreur inconnue.', 'Révocation impossible');
        return;
      }
      toast.success(`${revokeTarget.first_name} ${revokeTarget.last_name} révoqué.`);
      qc.invalidateQueries({ queryKey: queryKeys.adminStudents });
      setRevokeTarget(null);
      setRevokeReason('');
    } catch (e) {
      toast.error((e as Error).message ?? 'Erreur réseau.', 'Erreur');
    } finally {
      setRevoking(false);
    }
  }

  async function handlePurge() {
    if (!purgeTarget) return;
    if (purgeConfirm !== 'PURGE') {
      toast.error('Tape exactement PURGE pour confirmer.', 'Confirmation manquante');
      return;
    }
    setPurging(true);
    try {
      const r = await callAdminPurgeUser(purgeTarget.id, `manual purge from admin panel`);
      if (!r.ok) {
        toast.error(r.error, 'Purge impossible');
        return;
      }
      toast.success(`${purgeTarget.email} purgé (anonymisé + auth supprimé).`);
      qc.invalidateQueries({ queryKey: queryKeys.adminStudents });
      setPurgeTarget(null);
      setPurgeConfirm('');
    } catch (e) {
      toast.error((e as Error).message ?? 'Erreur réseau.', 'Erreur');
    } finally {
      setPurging(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (students ?? []).filter((s) => {
      if (tierFilter !== 'all' && s.tier !== tierFilter) return false;
      if (!q) return true;
      return (
        s.first_name.toLowerCase().includes(q) ||
        s.last_name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        (s.whatsapp || '').includes(q)
      );
    });
  }, [students, search, tierFilter]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Étudiants</h1>
        <p className="mt-1 text-slate-600">Tous tes étudiants inscrits.</p>
      </header>

      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-aurel-ink">
            <Users className="h-5 w-5 text-aurel-teal" />
            <span className="font-semibold">{filtered.length} étudiant{filtered.length > 1 ? 's' : ''}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input w-60 pl-9" placeholder="Rechercher nom, email, WhatsApp" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as 'all' | 'autonome' | 'accompagne')} className="input w-40">
              <option value="all">Tous tiers</option>
              <option value="autonome">Autonome</option>
              <option value="accompagne">Accompagné</option>
            </select>
            {/* SHERLOCK R14 — H10 : toggle "Inclure révoqués" */}
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={includeRevoked}
                onChange={(e) => setIncludeRevoked(e.target.checked)}
              />
              Inclure révoqués
            </label>
            <button onClick={handleExportCSV} className="btn-outline">
              <Download className="h-4 w-4" /> Exporter CSV
            </button>
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Chargement..." />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">Aucun étudiant.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Étudiant</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">WhatsApp</th>
                  <th className="px-4 py-3">Formule</th>
                  <th className="px-4 py-3">Cours</th>
                  <th className="px-4 py-3">Inscrit</th>
                  <th className="px-4 py-3">Dernière connexion</th>
                  <th className="w-10 px-2 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => {
                  const isRevoked = !!s.revoked_at;
                  return (
                  <tr key={s.id} className={cn('hover:bg-slate-50', isRevoked && 'opacity-70')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-aurel-teal text-xs font-bold text-white">
                          {initials(s.first_name, s.last_name)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-aurel-ink">{s.first_name} {s.last_name}</span>
                            {/* SHERLOCK R14 — H10 : badge Révoqué */}
                            {isRevoked && <span className="badge badge-orange text-red-700 bg-red-50 border-red-200">Révoqué</span>}
                          </div>
                          {s.diplome_algerien && <div className="text-xs text-slate-500">{s.diplome_algerien}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.email}</td>
                    <td className="px-4 py-3 text-slate-600">{s.whatsapp}</td>
                    <td className="px-4 py-3">
                      <span className={cn('badge', s.tier === 'accompagne' ? 'badge-teal' : 'badge-orange')}>
                        {tierLabel(s.tier)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {s.course_access === 'immigration' ? (
                        <span className="badge bg-aurel-orange-soft text-aurel-orange-dark inline-flex items-center gap-1">
                          <Plane className="h-3 w-3" /> Immigration
                        </span>
                      ) : (
                        <span className="badge badge-slate inline-flex items-center gap-1">
                          <BookOpen className="h-3 w-3" /> Pflege
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(s.activated_at)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(s.last_login_at)}</td>
                    <td className="px-2 py-3 relative">
                      {/* SHERLOCK R14 — H9 : kebab menu : Révoquer / Purger */}
                      <button
                        type="button"
                        onClick={() => setMenuOpenId((cur) => cur === s.id ? null : s.id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Actions"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {menuOpenId === s.id && (
                        <>
                          {/* Click outside */}
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setMenuOpenId(null)}
                            aria-hidden
                          />
                          <div className="absolute right-2 top-10 z-20 w-52 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
                            {/* Switch course access (single-course gating) */}
                            {s.course_access === 'immigration' ? (
                              <button
                                type="button"
                                onClick={() => handleSetCourse(s, 'pflege')}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                              >
                                <BookOpen className="h-4 w-4 text-aurel-teal" /> Passer à Pflege
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSetCourse(s, 'immigration')}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                              >
                                <Plane className="h-4 w-4 text-aurel-orange" /> Donner accès Immigration
                              </button>
                            )}
                            <div className="my-1 border-t border-slate-100" />
                            {!isRevoked && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setRevokeTarget(s);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                              >
                                <Ban className="h-4 w-4 text-red-500" /> Révoquer
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setMenuOpenId(null);
                                setPurgeTarget(s);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" /> Purger (GDPR)
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SHERLOCK R14 — H9 : modal de révocation. */}
      <Modal
        open={!!revokeTarget}
        onClose={() => { if (!revoking) { setRevokeTarget(null); setRevokeReason(''); } }}
        title="Révoquer ce compte"
        maxWidth="max-w-md"
      >
        {revokeTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Tu vas révoquer <strong>{revokeTarget.first_name} {revokeTarget.last_name}</strong>{' '}
              ({revokeTarget.email}). Le compte ne pourra plus se connecter, mais ses données restent en DB.
              Réversible via SQL admin si besoin.
            </p>
            <div>
              <label className="label">Raison (audit)</label>
              <textarea
                className="input min-h-[80px]"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Ex : Demande de remboursement, fraude détectée, etc."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setRevokeTarget(null); setRevokeReason(''); }}
                disabled={revoking}
                className="btn-outline"
              >
                <X className="h-4 w-4" /> Annuler
              </button>
              <button
                type="button"
                onClick={handleRevoke}
                disabled={revoking || !revokeReason.trim()}
                className="btn-danger"
              >
                <Ban className="h-4 w-4" /> Révoquer
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* SHERLOCK R14 — H9 : modal de purge GDPR. */}
      <Modal
        open={!!purgeTarget}
        onClose={() => { if (!purging) { setPurgeTarget(null); setPurgeConfirm(''); } }}
        title="Purger ce compte (GDPR Art. 17)"
        maxWidth="max-w-md"
      >
        {purgeTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <strong>Action irréversible.</strong> Anonymise le profile, supprime
              les notes, scrub feedback + email_logs, et hard-delete l'entrée
              auth.users. Le compte ne pourra jamais être restauré.
            </div>
            <p className="text-sm text-slate-600">
              Cible : <strong>{purgeTarget.first_name} {purgeTarget.last_name}</strong> ({purgeTarget.email})
            </p>
            <div>
              <label className="label">Tape <code className="font-mono text-red-600">PURGE</code> pour confirmer</label>
              <input
                className="input font-mono"
                value={purgeConfirm}
                onChange={(e) => setPurgeConfirm(e.target.value)}
                placeholder="PURGE"
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setPurgeTarget(null); setPurgeConfirm(''); }}
                disabled={purging}
                className="btn-outline"
              >
                <X className="h-4 w-4" /> Annuler
              </button>
              <button
                type="button"
                onClick={handlePurge}
                disabled={purging || purgeConfirm !== 'PURGE'}
                className="btn-danger"
              >
                <Trash2 className="h-4 w-4" /> Purger définitivement
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
