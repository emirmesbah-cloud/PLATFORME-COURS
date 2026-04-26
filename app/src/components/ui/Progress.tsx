import { cn } from '@/lib/utils';

export function ProgressBar({
  value, max = 100, className, color = 'orange',
}: {
  value: number;
  max?: number;
  className?: string;
  color?: 'orange' | 'teal' | 'green';
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bg = color === 'teal' ? 'bg-aurel-teal' : color === 'green' ? 'bg-green-500' : 'bg-aurel-orange';
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all', bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}
