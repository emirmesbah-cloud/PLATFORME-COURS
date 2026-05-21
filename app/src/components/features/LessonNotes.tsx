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
  // SHERLOCK R13 — B11: skip setState after unmount to avoid "set state on
  // unmounted component" warnings + leak of the saved/idle timer if the user
  // navigates away mid-upsert.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // SHERLOCK FIX : ref pour donner accès au content courant au cleanup
  // du flush effect SANS lister `content` dans les deps. Avant : `content`
  // était dans les deps de l'effect flush → cleanup re-tournait à chaque
  // keystroke et déclenchait un upsert avec l'ancienne valeur → DB spam.
  const contentRef = useRef(content);
  contentRef.current = content;
  // SHERLOCK R14 — C1 : track la dernière valeur effectivement sauvée en DB.
  // Le flush cleanup ne fire l'upsert QUE si le contenu courant est différent
  // de ce qui a déjà été sauvé ET non-vide. Empty-string overwrite (bash
  // sur les notes existantes du nouveau lesson au moment d'une transition)
  // était le failure mode principal.
  const lastSavedRef = useRef<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.lessonNote(uid, lessonId),
    queryFn: () => fetchLessonNote(uid, lessonId),
    enabled: !!uid && !!lessonId,
  });

  // Hydrate textarea once data is loaded
  useEffect(() => {
    if (!isLoading && !didLoadRef.current) {
      const initial = data?.content ?? '';
      setContent(initial);
      // SHERLOCK R14 — C1 : seed lastSavedRef avec la valeur DB initiale
      // pour que la première comparaison contentRef vs lastSavedRef soit
      // exacte. Sans seed, n'importe quel keystroke initial déclencherait
      // un upsert "différent" même si le content n'a pas vraiment changé.
      lastSavedRef.current = initial;
      didLoadRef.current = true;
    }
  }, [isLoading, data]);

  // Reset hydration flag when lesson changes
  // SHERLOCK R3 fix : also reset contentRef so the unmount flush doesn't
  // overwrite the new lesson's notes with the previous lesson's content
  // when the component re-mounts mid-flight.
  // SHERLOCK R14 — C1 : on n'a PLUS besoin de bash contentRef='' ici. Le
  // flush cleanup ignore déjà le '' overwrite (voir cleanup ci-dessous).
  // Bash contentRef vide était la cause directe du bug : la cleanup
  // précédente s'exécutait AVEC ce '' et sauvait par-dessus les notes du
  // nouveau lesson. Maintenant le cleanup checke `current === ''` → skip.
  useEffect(() => {
    didLoadRef.current = false;
    setContent('');
    lastSavedRef.current = null;
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
        // SHERLOCK R14 — C1 : record la valeur sauvée pour le diff du cleanup.
        lastSavedRef.current = value;
        // SHERLOCK R13 — B11: bail if user navigated away mid-flight.
        if (!mountedRef.current) return;
        qc.invalidateQueries({ queryKey: queryKeys.lessonNote(uid, lessonId) });
        setStatus('saved');
        setTimeout(() => { if (mountedRef.current) setStatus('idle'); }, 2000);
      } catch {
        if (mountedRef.current) setStatus('idle');
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  // Flush on unmount (or lesson change). Reads contentRef synchrone pour
  // avoir la dernière valeur saisie. PAS de `content` dans les deps :
  // sinon le cleanup re-fire à chaque keystroke → upsert flood.
  // SHERLOCK R14 — C1 : on skip l'upsert si :
  //   (a) content courant === dernière valeur sauvée (rien à flusher),
  //   (b) content === '' ET didLoadRef est false (on est en plein reset
  //       effect — le reset bash contentRef='' AVANT que ce cleanup ne
  //       fire pas, mais didLoadRef.current=false couvre l'état "data
  //       jamais hydraté donc on a rien à sauver"),
  //   (c) le content actuel est vide ET ne match pas un état "user a
  //       vraiment effacé ses notes" (= lastSavedRef contient du texte
  //       qu'on remplacerait par '' — possible mais on choisit la safety
  //       quitte à perdre un clear volontaire. L'user peut retaper '' au
  //       prochain mount et l'autosave debounce le sauvera).
  // Empty-string overwrite était le failure mode principal — protect at
  // all costs.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
      if (!uid || !lessonId || !didLoadRef.current) return;
      const current = contentRef.current;
      if (current === lastSavedRef.current) return;
      if (current === '') return; // never overwrite saved content with empty
      // Final save (best-effort)
      upsertLessonNote(uid, lessonId, current).catch(() => {});
    };
  }, [uid, lessonId]);

  return (
    <div>
      {/* SHERLOCK R14 — M5 : maxLength côté client = miroir du CHECK
          `lesson_notes_content_length_check (length(content) <= 50000)`
          côté DB. Évite que le user remplisse 200k chars puis se prenne un
          rejet DB silencieux après debounce. */}
      <textarea
        className="input min-h-[280px] resize-y font-mono text-sm leading-relaxed"
        placeholder={'Tes notes personnelles pour cette leçon…\n\n• Mots de vocabulaire à retenir\n• Astuces du formateur\n• Questions à poser à Aurel'}
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck
        maxLength={50000}
      />
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-slate-400">{content.length}/50000 caractères · sauvegarde auto toutes les 3s</span>
        <span className="flex items-center gap-1 font-medium">
          {status === 'saving' && <><Save className="h-3.5 w-3.5 animate-pulse text-aurel-orange" /> Sauvegarde…</>}
          {status === 'saved'  && <><Check className="h-3.5 w-3.5 text-green-600" /> Notes sauvegardées</>}
        </span>
      </div>
    </div>
  );
}
