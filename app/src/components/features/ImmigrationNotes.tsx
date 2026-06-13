import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { fetchImmigrationNote, saveImmigrationNote } from '@/lib/immigration';

/**
 * ImmigrationNotes — student's personal notes for a lesson, saved in DB
 * (immigration_notes) with debounced autosave. Mirrors the Pflege Notes feel.
 */
export function ImmigrationNotes({ lessonSlug }: { lessonSlug: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['immigration-note', lessonSlug],
    queryFn: () => fetchImmigrationNote(lessonSlug),
    staleTime: 60 * 1000,
  });

  const [value, setValue] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string | null>(null);

  // Hydrate when the note loads (once per lesson).
  useEffect(() => {
    if (data !== undefined && loadedFor.current !== lessonSlug) {
      setValue(data);
      loadedFor.current = lessonSlug;
    }
  }, [data, lessonSlug]);

  function onChange(next: string) {
    setValue(next);
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await saveImmigrationNote(lessonSlug, next);
        setState('saved');
        setTimeout(() => setState('idle'), 1500);
      } catch {
        setState('idle');
      }
    }, 800);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-[13px] font-semibold text-zinc-900">Mes notes</label>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          {state === 'saving' && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Sauvegarde…</span>}
          {state === 'saved' && <span className="inline-flex items-center gap-1 text-green-600"><Check className="h-3 w-3" /> Enregistré</span>}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={isLoading}
        placeholder="Note ici tes points clés, questions, démarches à faire…"
        className="input min-h-[160px] w-full resize-y text-sm leading-relaxed"
      />
      <p className="mt-2 font-mono text-[10px] text-zinc-400">
        Tes notes sont privées et sauvegardées automatiquement.
      </p>
    </div>
  );
}
