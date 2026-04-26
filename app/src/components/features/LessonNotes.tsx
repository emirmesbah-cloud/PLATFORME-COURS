import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Check } from 'lucide-react';
import { fetchLessonNote, upsertLessonNote, queryKeys } from '@/lib/queries';
import { useAuth } from '@/hooks/useAuth';

const AUTOSAVE_DEBOUNCE_MS = 3000;

export function LessonNotes({ lessonId }: { lessonId: string }) {
  const { user } = useAuth();
  const uid = user?.id ?? '';
  const qc = useQueryClient();

  const [content, setContent] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const debounceRef = useRef<number | null>(null);
  const didLoadRef = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.lessonNote(uid, lessonId),
    queryFn: () => fetchLessonNote(uid, lessonId),
    enabled: !!uid && !!lessonId,
  });

  // Hydrate textarea once data is loaded
  useEffect(() => {
    if (!isLoading && !didLoadRef.current) {
      setContent(data?.content ?? '');
      didLoadRef.current = true;
    }
  }, [isLoading, data]);

  // Reset hydration flag when lesson changes
  useEffect(() => {
    didLoadRef.current = false;
    setContent('');
    setStatus('idle');
  }, [lessonId]);

  // Auto-save with debounce
  function handleChange(value: string) {
    setContent(value);
    if (!uid || !lessonId) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setStatus('saving');
    debounceRef.current = window.setTimeout(async () => {
      try {
        await upsertLessonNote(uid, lessonId, value);
        qc.invalidateQueries({ queryKey: queryKeys.lessonNote(uid, lessonId) });
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      } catch {
        setStatus('idle');
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        // Final save (best-effort)
        if (uid && lessonId && didLoadRef.current) {
          upsertLessonNote(uid, lessonId, content).catch(() => {});
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, lessonId, content]);

  return (
    <div>
      <textarea
        className="input min-h-[280px] resize-y font-mono text-sm leading-relaxed"
        placeholder={'Tes notes personnelles pour cette leçon…\n\n• Mots de vocabulaire à retenir\n• Astuces du formateur\n• Questions à poser à Aurel'}
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck
      />
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-slate-400">{content.length} caractères · sauvegarde auto toutes les 3s</span>
        <span className="flex items-center gap-1 font-medium">
          {status === 'saving' && <><Save className="h-3.5 w-3.5 animate-pulse text-aurel-orange" /> Sauvegarde…</>}
          {status === 'saved'  && <><Check className="h-3.5 w-3.5 text-green-600" /> Notes sauvegardées</>}
        </span>
      </div>
    </div>
  );
}
