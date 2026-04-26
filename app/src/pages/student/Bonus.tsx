import { useQuery } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import { fetchBonus, queryKeys } from '@/lib/queries';
import { BonusCard } from '@/components/features/BonusCard';
import { Spinner } from '@/components/ui/Spinner';

export function StudentBonus() {
  const { data: bonus, isLoading } = useQuery({ queryKey: queryKeys.bonus, queryFn: fetchBonus });

  if (isLoading) return <Spinner label="Chargement des bonus..." />;

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2">
        {(bonus ?? []).map((b) => <BonusCard key={b.id} bonus={b} />)}
      </div>
    </div>
  );
}
