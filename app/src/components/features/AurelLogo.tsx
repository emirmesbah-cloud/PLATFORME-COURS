import { cn } from '@/lib/utils';

export function AurelLogo({ size = 'md', withText = true, className }: {
  size?: 'sm' | 'md' | 'lg';
  withText?: boolean;
  className?: string;
}) {
  const dim = size === 'sm' ? 'h-7 w-7 text-sm' : size === 'lg' ? 'h-12 w-12 text-2xl' : 'h-9 w-9 text-base';
  const text = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className={cn('flex items-center justify-center rounded-full bg-aurel-orange font-serif font-bold text-white', dim)}>
        A
      </div>
      {withText && (
        <span className={cn('font-semibold leading-none text-aurel-ink', text)}>
          Aurel <span className="font-serif italic font-normal">Academy</span>
        </span>
      )}
    </div>
  );
}
