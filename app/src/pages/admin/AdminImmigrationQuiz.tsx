import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Check, AlertCircle, Plane } from 'lucide-react';
import {
  adminFetchAllImmigrationQuestions, adminUpsertImmigrationQuestion, adminDeleteImmigrationQuestion,
  type ImmigrationQuizQuestionAdmin, type ImmigrationQuestionInput,
} from '@/lib/immigration';
import { IMMIGRATION_FLAT_LESSONS } from '@/data/immigration-structure';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

/**
 * AdminImmigrationQuiz — CRUD for immigration_quiz_questions.
 * Lesson picker fed by the static IMMIGRATION_FLAT_LESSONS (slug + module).
 * Mirrors AdminQuiz (Pflege).
 */
export function AdminImmigrationQuiz() {
  const qc = useQueryClient();
  const toast = useToast();

  const questionsQ = useQuery({
    queryKey: ['admin-immigration-questions'],
    queryFn: adminFetchAllImmigrationQuestions,
  });
  const all = questionsQ.data ?? [];

  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [editing, setEditing] = useState<ImmigrationQuestionInput | null>(null);

  const defaultSlug = useMemo(
    () => selectedSlug || IMMIGRATION_FLAT_LESSONS[0]?.slug || '',
    [selectedSlug],
  );
  const currentSlug = selectedSlug || defaultSlug;
  const currentLesson = IMMIGRATION_FLAT_LESSONS.find((l) => l.slug === currentSlug);
  const questions = all.filter((q) => q.lesson_slug === currentSlug).sort((a, b) => a.position - b.position);

  // Per-lesson question counts (for the picker badges).
  const countBySlug = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of all) m.set(q.lesson_slug, (m.get(q.lesson_slug) ?? 0) + 1);
    return m;
  }, [all]);

  async function handleSave(draft: ImmigrationQuestionInput) {
    try {
      await adminUpsertImmigrationQuestion({
        ...draft,
        question_text: draft.question_text.trim(),
        option_a: draft.option_a.trim(), option_b: draft.option_b.trim(),
        option_c: draft.option_c.trim(), option_d: draft.option_d.trim(),
        explanation: draft.explanation?.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ['admin-immigration-questions'] });
      toast.success(draft.id ? 'Question mise à jour.' : 'Question ajoutée.');
      setEditing(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur.');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cette question ?')) return;
    try {
      await adminDeleteImmigrationQuestion(id);
      qc.invalidateQueries({ queryKey: ['admin-immigration-questions'] });
      toast.success('Question supprimée.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur.');
    }
  }

  function startCreate() {
    if (!currentLesson) return;
    const nextPos = questions.length === 0 ? 1 : Math.max(...questions.map((q) => q.position)) + 1;
    setEditing({
      lesson_slug: currentLesson.slug, module_slug: currentLesson.moduleSlug, position: nextPos,
      question_text: '', option_a: '', option_b: '', option_c: '', option_d: '',
      correct_index: 0, explanation: '',
    });
  }

  function startEdit(q: ImmigrationQuizQuestionAdmin) {
    setEditing({
      id: q.id, lesson_slug: q.lesson_slug, module_slug: q.module_slug, position: q.position,
      question_text: q.question_text, option_a: q.option_a, option_b: q.option_b,
      option_c: q.option_c, option_d: q.option_d, correct_index: q.correct_index,
      explanation: q.explanation ?? '',
    });
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <Plane className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Quiz · Immigration</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink">Questions — cours Immigration</h1>
        <p className="mt-1 text-slate-600">
          5 questions par leçon. Seuil ≥ 3/5. Le verrouillage progressif s'applique aux 11 modules principaux.
        </p>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[320px] flex-1 md:max-w-xl">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Leçon</label>
          <select className="input w-full" value={currentSlug}
            onChange={(e) => { setSelectedSlug(e.target.value); setEditing(null); }}>
            {IMMIGRATION_FLAT_LESSONS.map((l) => {
              const n = countBySlug.get(l.slug) ?? 0;
              return (
                <option key={l.slug} value={l.slug}>
                  [{l.id}] {l.title} {n > 0 ? `· ${n}Q` : '· (vide)'}
                </option>
              );
            })}
          </select>
        </div>
        {currentLesson && (
          <button onClick={startCreate} className="btn-primary">
            <Plus className="h-4 w-4" /> Ajouter une question
          </button>
        )}
      </div>

      {editing && <QuestionForm draft={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={() => handleSave(editing)} />}

      {questionsQ.isLoading ? (
        <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="card-padded animate-pulse"><div className="h-4 w-3/4 rounded bg-slate-200" /></div>)}</div>
      ) : questions.length === 0 ? (
        <div className="card-padded text-center text-slate-500">Aucune question pour cette leçon.</div>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => <QuestionRow key={q.id} q={q} onEdit={() => startEdit(q)} onDelete={() => handleDelete(q.id)} />)}
        </div>
      )}
    </div>
  );
}

function QuestionRow({ q, onEdit, onDelete }: { q: ImmigrationQuizQuestionAdmin; onEdit: () => void; onDelete: () => void }) {
  const correctLetter = (['A', 'B', 'C', 'D'] as const)[q.correct_index];
  const options = [q.option_a, q.option_b, q.option_c, q.option_d];
  return (
    <div className="card-padded">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">#{q.position}</span>
            <span className="rounded-full bg-aurel-teal/10 px-2 py-0.5 text-xs font-bold text-aurel-teal">Bonne réponse : {correctLetter}</span>
          </div>
          <p className="text-sm font-semibold text-aurel-ink">{q.question_text}</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {options.map((opt, i) => (
              <li key={i} className={cn(i === q.correct_index && 'font-semibold text-aurel-teal')}>
                {(['A','B','C','D'] as const)[i]}. {opt}
              </li>
            ))}
          </ul>
          {q.explanation && <p className="mt-2 rounded bg-slate-50 p-2 text-xs italic text-slate-500">💡 {q.explanation}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <button onClick={onEdit} className="btn-ghost text-aurel-orange-dark" aria-label="Éditer"><Pencil className="h-4 w-4" /></button>
          <button onClick={onDelete} className="btn-ghost text-red-500 hover:text-red-700" aria-label="Supprimer"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}

function QuestionForm({ draft, onChange, onCancel, onSave }: {
  draft: ImmigrationQuestionInput;
  onChange: (n: ImmigrationQuestionInput) => void;
  onCancel: () => void; onSave: () => void;
}) {
  const errors: string[] = [];
  if (!draft.question_text.trim()) errors.push('La question ne peut pas être vide.');
  if (!draft.option_a.trim() || !draft.option_b.trim() || !draft.option_c.trim() || !draft.option_d.trim())
    errors.push('Les 4 options doivent être renseignées.');
  if (draft.position < 1) errors.push('Position ≥ 1.');
  const valid = errors.length === 0;

  return (
    <div className="card border-aurel-orange/50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-bold text-aurel-ink">{draft.id ? 'Éditer la question' : 'Nouvelle question'}</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Énoncé</label>
            <textarea className="input min-h-[80px] w-full" value={draft.question_text}
              onChange={(e) => onChange({ ...draft, question_text: e.target.value })} placeholder="ex : Quelle est la première démarche à l'arrivée ?" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Position</label>
            <input type="number" min={1} max={50} className="input w-full text-center" value={draft.position}
              onChange={(e) => onChange({ ...draft, position: Number(e.target.value) || 1 })} />
          </div>
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Options (coche la bonne)</label>
          {(['A','B','C','D'] as const).map((letter, i) => {
            const key = `option_${letter.toLowerCase()}` as 'option_a' | 'option_b' | 'option_c' | 'option_d';
            const isCorrect = draft.correct_index === i;
            return (
              <div key={letter} className="flex items-center gap-2">
                <span className={cn('flex h-9 w-9 flex-none items-center justify-center rounded-md font-bold', isCorrect ? 'bg-aurel-teal text-white' : 'bg-slate-100 text-slate-500')}>{letter}</span>
                <input className="input flex-1" value={draft[key]} onChange={(e) => onChange({ ...draft, [key]: e.target.value })} placeholder={`Option ${letter}`} />
                <label className={cn('flex cursor-pointer items-center gap-1 rounded-md border px-3 py-2 text-xs font-medium transition', isCorrect ? 'border-aurel-teal bg-aurel-teal/10 text-aurel-teal' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>
                  <input type="radio" name="imm_correct" className="sr-only" checked={isCorrect} onChange={() => onChange({ ...draft, correct_index: i as 0|1|2|3 })} />
                  {isCorrect ? <><Check className="h-3.5 w-3.5" /> Correct</> : 'Correct ?'}
                </label>
              </div>
            );
          })}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Explication (optionnelle)</label>
          <textarea className="input min-h-[60px] w-full" value={draft.explanation ?? ''}
            onChange={(e) => onChange({ ...draft, explanation: e.target.value })} placeholder="Affichée après le quiz." />
        </div>
        {errors.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <ul className="space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onCancel} className="btn-outline">Annuler</button>
          <button onClick={onSave} disabled={!valid} className="btn-primary disabled:opacity-50"><Check className="h-4 w-4" /> {draft.id ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </div>
    </div>
  );
}
