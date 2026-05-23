import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import { fetchBonus, queryKeys } from '@/lib/queries';
import { BonusCard } from '@/components/features/BonusCard';

export function StudentBonus() {
  const bonusQ = useQuery({ queryKey: queryKeys.bonus, queryFn: fetchBonus });
  const bonus = bonusQ.data ?? [];
  const isLoading = bonusQ.isLoading && bonus.length === 0;
  const hasError = bonusQ.isError && bonus.length === 0;

  // Auto-escape : if loading >8s, show retry banner instead of infinite skeleton.
  const [slowNetwork, setSlowNetwork] = useState(false);
  useEffect(() => {
    if (bonus.length > 0) { setSlowNetwork(false); return; }
    const t = setTimeout(() => setSlowNetwork(true), 8000);
    return () => clearTimeout(t);
  }, [bonus.length]);

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <Gift className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Tes 7 ressources bonus</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink md:text-4xl">Documents & guides</h1>
        <p className="mt-1 max-w-2xl text-slate-600">
          Tous les supports écrits qui complètent les vidéos. Glossaire trilingue, templates CV, lettres de motivation,
          guide Anerkennung, méthode prospection.
        </p>
      </header>

      {(hasError || (slowNetwork && isLoading)) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Connexion lente détectée</p>
          <p className="mt-1">Les bonus mettent du temps à charger. Réessaie ou recharge la page complètement (Ctrl+Shift+R).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => bonusQ.refetch()} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700">Réessayer</button>
            <button onClick={() => window.location.reload()} className="rounded-lg border border-amber-600 px-4 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">Recharger la page</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2">
        {isLoading && !slowNetwork
          ? Array.from({ length: 4 }).map((_, i) => <BonusSkeletonCard key={i} />)
          : bonus.map((b) => <BonusCard key={b.id} bonus={b} />)}
      </div>
    </div>
  );
}

function BonusSkeletonCard() {
  return (
    <div className="card animate-pulse p-5">
      <div className="mb-3 h-5 w-2/3 rounded bg-slate-200" />
      <div className="mb-2 h-4 w-full rounded bg-slate-100" />
      <div className="mb-4 h-4 w-3/4 rounded bg-slate-100" />
      <div className="h-9 w-32 rounded bg-slate-200" />
    </div>
  );
}
