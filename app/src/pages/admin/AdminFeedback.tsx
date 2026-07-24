import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, Check, X, Heart } from 'lucide-react';
import { fetchAdminFeedback, adminToggleFeedbackApproved, queryKeys } from '@/lib/queries';
import type { Feedback } from '@/lib/types';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { formatDate, cn } from '@/lib/utils';

// SHERLOCK R14 — L8 : ajout du filter "critiques" (rating ≤ 2). Sans ça
// l'admin doit scroller la liste entière pour repérer les avis négatifs
// qui méritent un follow-up perso WhatsApp.
type Filter = 'all' | 'pending' | 'approved' | 'public' | 'critiques';

export function AdminFeedback() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.adminFeedback,
    queryFn: fetchAdminFeedback,
  });

  const filtered = useMemo(() => {
    const all = data ?? [];
    if (filter === 'pending')   return all.filter((f) => !f.is_approved);
    if (filter === 'approved')  return all.filter((f) => f.is_approved);
    if (filter === 'public')    return all.filter((f) => f.is_public && f.is_approved);
    if (filter === 'critiques') return all.filter((f) => f.rating <= 2);
    return all;
  }, [data, filter]);

  async function handleToggle(id: string, current: boolean) {
    try {
      await adminToggleFeedbackApproved(id, !current);
      qc.invalidateQueries({ queryKey: queryKeys.adminFeedback });
      toast.success(current ? 'Avis mis en attente.' : 'Avis approuvé.');
    } catch {
      toast.error('Erreur, réessaie.');
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <Heart className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Modération</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink">Avis des étudiants</h1>
        <p className="mt-1 text-slate-600">Approuve les témoignages publics avant qu'ils n'apparaissent sur les landings.</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {(['all', 'pending', 'approved', 'public', 'critiques'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition',
              filter === f ? 'bg-aurel-orange text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
          >
            {f === 'all' && 'Tous'}
            {f === 'pending' && 'En attente'}
            {f === 'approved' && 'Approuvés'}
            {f === 'public' && 'Publics affichables'}
            {/* SHERLOCK R14 — L8 */}
            {f === 'critiques' && 'Critiques (1-2★)'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner label="Chargement..." />
      ) : filtered.length === 0 ? (
        <div className="card-padded text-center text-slate-500">Aucun avis.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map((f) => {
            // Feedback rows joined with profiles via fetchAdminFeedback.
            const profile = (f as Feedback & { profile?: { first_name?: string; last_name?: string; email?: string } }).profile;
            return (
              <div key={f.id} className="card-padded space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-aurel-ink">
                      {profile?.first_name} {profile?.last_name}
                    </div>
                    <div className="text-xs text-slate-400">{profile?.email}</div>
                    <div className="text-xs text-slate-400">{formatDate(f.submitted_at)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {f.is_approved
                      ? <span className="badge badge-green">Approuvé</span>
                      : <span className="badge badge-orange">En attente</span>
                    }
                    {f.is_public && <span className="badge badge-teal">Public OK</span>}
                    {!f.is_public && f.publish_consent && <span className="badge badge-teal">Consentement public</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={cn(
                      'h-4 w-4',
                      f.rating >= n ? 'fill-aurel-orange text-aurel-orange' : 'text-slate-300'
                    )} />
                  ))}
                  <span className="ml-1 text-xs text-slate-500">{f.rating}/5</span>
                  <span className="ml-3 text-xs">
                    {f.would_recommend ? '👍 Recommande' : '👎 Ne recommande pas'}
                  </span>
                </div>

                {f.testimonial ? (
                  <blockquote className="rounded-lg bg-slate-50 p-3 text-sm italic text-slate-700">
                    « {f.testimonial} »
                  </blockquote>
                ) : (
                  <p className="text-sm text-slate-400">Pas de témoignage écrit.</p>
                )}

                <div className="flex gap-2">
                  <button onClick={() => handleToggle(f.id, f.is_approved)}
                    className={f.is_approved ? 'btn-outline' : 'btn-secondary'}>
                    {f.is_approved
                      ? <><X className="h-4 w-4" /> Retirer approbation</>
                      : <><Check className="h-4 w-4" /> Approuver</>
                    }
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
