import { cn } from '@/lib/utils';

export function ProgressBar({
  value, max = 100, className, color = 'orange', label,
}: {
  value: number;
  max?: number;
  className?: string;
  color?: 'orange' | 'teal' | 'green';
  /** Accessible label, default = "Progression" */
  label?: string;
}) {
  // SHERLOCK R14 — M6 : guard divide-by-zero. Si max=0 (cas border : appelant
  // qui passe par accident un compteur vide), `value/0` = Infinity → 100%
  // affiché alors qu'il n'y a rien à progresser. Maintenant on clamp safe.
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const bg = color === 'teal' ? 'bg-aurel-teal' : color === 'green' ? 'bg-green-500' : 'bg-aurel-orange';
  // SHERLOCK R14 — M6 : ARIA progressbar role + valuenow/min/max + label.
  // Sans ça, NVDA/JAWS annonce juste "graphique" sans la valeur courante.
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || 'Progression'}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}
    >
      <div className={cn('h-full rounded-full transition-all', bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}
