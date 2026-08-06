import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { fetchImmigrationNote, saveImmigrationNote } from '@/lib/immigration';

/**
 * ImmigrationNotes — student's personal notes for a lesson, saved in DB
 * (immigration_notes) with debounced autosave. Mirrors the Pflege Notes feel.
 */
export function ImmigrationNotes({ lessonSlug }: { lessonSlug: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['immigration-note', lessonSlug],
    queryFn: () => fetchImmigrationNote(lessonSlug),
    staleTime: 60 * 1000,
  });

  const [value, setValue] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string | null>(null);

  // Hydrate when the note loads (once per lesson).
  useEffect(() => {
    if (data !== undefined && loadedFor.current !== lessonSlug) {
      setValue(data);
      loadedFor.current = lessonSlug;
    }
  }, [data, lessonSlug]);

  async function persist(next: string) {
    setState('saving');
    try {
      await saveImmigrationNote(lessonSlug, next);
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('error');
    }
  }

  function onChange(next: string) {
    setValue(next);
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(next); }, 800);
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <div>
          <p className="font-semibold text-zinc-900">Tes notes n'ont pas pu charger</p>
          <p className="mt-1 text-sm text-zinc-600">Aucune note ne sera écrasée. Réessaie quand la connexion revient.</p>
        </div>
        <button onClick={() => refetch()} className="btn-primary">
          <RefreshCw className="h-4 w-4" /> Réessayer
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-[13px] font-semibold text-zinc-900">Mes notes</label>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          {state === 'saving' && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Sauvegarde…</span>}
          {state === 'saved' && <span className="inline-flex items-center gap-1 text-green-600"><Check className="h-3 w-3" /> Enregistré</span>}
          {state === 'error' && (
            <button onClick={() => void persist(value)} className="inline-flex items-center gap-1 text-red-600 hover:underline">
              <XCircle className="h-3 w-3" /> Non enregistré — réessayer
            </button>
          )}
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
