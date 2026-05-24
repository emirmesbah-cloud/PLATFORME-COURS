import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Check, AlertCircle, GraduationCap } from 'lucide-react';
import {
  fetchLessons,
  adminFetchAllQuizQuestions,
  adminUpsertQuizQuestion,
  adminDeleteQuizQuestion,
  queryKeys,
} from '@/lib/queries';
import type { QuizQuestion } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

/**
 * AdminQuiz — page CRUD des questions de quiz.
 *
 * Layout : liste filtrée par leçon (sélecteur en haut). Une question = une
 * carte cliquable. Bouton "+" en haut à droite pour ajouter une question
 * dans la leçon sélectionnée. Le formulaire est inline (modal-like) au-dessus
 * de la liste, simple à utiliser sans navigation.
 *
 * Règle métier rappelée dans l'UI : leçons 1 et 2 (Disclaimer / Willkommen)
 * n'ont volontairement pas de quiz. Si l'admin sélectionne ces leçons, on
 * affiche un message d'info.
 */
export function AdminQuiz() {
  const qc = useQueryClient();
  const toast = useToast();

  const lessonsQ = useQuery({ queryKey: queryKeys.lessons, queryFn: fetchLessons });
  const questionsQ = useQuery({
    queryKey: queryKeys.adminAllQuizQuestions,
    queryFn: adminFetchAllQuizQuestions,
  });

  const lessons = lessonsQ.data ?? [];
  const allQuestions = questionsQ.data ?? [];

  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  // null = pas en édition. Sinon : draft de question (id absent = création).
  const [editing, setEditing] = useState<DraftQuestion | null>(null);

  // Auto-sélection de la première leçon (qui a des questions) au chargement.
  const defaultLesson = useMemo(() => {
    if (selectedLessonId) return selectedLessonId;
    const first = lessons.find((l) => l.lesson_number >= 3) ?? lessons[0];
    return first?.id ?? '';
  }, [selectedLessonId, lessons]);

  const currentLessonId = selectedLessonId || defaultLesson;
  const currentLesson = lessons.find((l) => l.id === currentLessonId);
  const questions = allQuestions
    .filter((q) => q.lesson_id === currentLessonId)
    .sort((a, b) => a.position - b.position);

  // Leçons sans quiz volontairement.
  const isIntroLesson = currentLesson
    ? currentLesson.lesson_number <= 2
    : false;

  async function handleSave(draft: DraftQuestion) {
    try {
      await adminUpsertQuizQuestion({
        id:           draft.id,
        lesson_id:    draft.lesson_id,
        position:     draft.position,
        question_text: draft.question_text.trim(),
        option_a:     draft.option_a.trim(),
        option_b:     draft.option_b.trim(),
        option_c:     draft.option_c.trim(),
        option_d:     draft.option_d.trim(),
        correct_index: draft.correct_index,
        explanation:  draft.explanation?.trim() || null,
      });
      qc.invalidateQueries({ queryKey: queryKeys.adminAllQuizQuestions });
      toast.success(draft.id ? 'Question mise à jour.' : 'Question ajoutée.');
      setEditing(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur.';
      toast.error(msg);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cette question ? Action irréversible.')) return;
    try {
      await adminDeleteQuizQuestion(id);
      qc.invalidateQueries({ queryKey: queryKeys.adminAllQuizQuestions });
      toast.success('Question supprimée.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur.';
      toast.error(msg);
    }
  }

  function startCreate() {
    if (!currentLesson) return;
    // Position = max existing + 1
    const nextPos = questions.length === 0 ? 1 : Math.max(...questions.map((q) => q.position)) + 1;
    setEditing({
      lesson_id: currentLesson.id,
      position: nextPos,
      question_text: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_index: 0,
      explanation: '',
    });
  }

  function startEdit(q: QuizQuestion) {
    setEditing({
      id: q.id,
      lesson_id: q.lesson_id,
      position: q.position,
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_index: q.correct_index,
      explanation: q.explanation ?? '',
    });
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <GraduationCap className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Quiz</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink">Questions de quiz</h1>
        <p className="mt-1 text-slate-600">
          5 questions par leçon de contenu. L'étudiant doit avoir ≥ 3/5 pour valider une leçon
          et débloquer la suivante.
        </p>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[280px] flex-1 md:max-w-md">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Leçon
          </label>
          <select
            className="input w-full"
            value={currentLessonId}
            onChange={(e) => { setSelectedLessonId(e.target.value); setEditing(null); }}
          >
            {lessons
              .slice()
              .sort((a, b) => a.lesson_number - b.lesson_number)
              .map((l) => (
              <option key={l.id} value={l.id}>
                {String(l.lesson_number).padStart(2, '0')} — {l.title}
                {l.lesson_number <= 2 ? ' (pas de quiz)' : ''}
              </option>
            ))}
          </select>
        </div>
        {!isIntroLesson && currentLesson && (
          <button onClick={startCreate} className="btn-primary">
            <Plus className="h-4 w-4" /> Ajouter une question
          </button>
        )}
      </div>

      {isIntroLesson && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-semibold text-aurel-ink">Pas de quiz pour cette leçon</p>
          <p className="mt-1">
            Les leçons 1 (Disclaimer) et 2 (Willkommen) sont des introductions et n'ont
            volontairement pas de quiz. La leçon 1 est toujours débloquée ; la 2 se débloque
            dès que la 1 est terminée.
          </p>
        </div>
      )}

      {/* Form inline */}
      {editing && (
        <QuestionForm
          draft={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => handleSave(editing)}
        />
      )}

      {/* Liste questions */}
      {!isIntroLesson && (
        <>
          {questionsQ.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card-padded animate-pulse">
                  <div className="h-4 w-3/4 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          ) : questions.length === 0 ? (
            <div className="card-padded text-center text-slate-500">
              Aucune question pour cette leçon. Clique sur « Ajouter une question » pour commencer.
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((q) => (
                <QuestionRow
                  key={q.id}
                  question={q}
                  onEdit={() => startEdit(q)}
                  onDelete={() => handleDelete(q.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ─── Components ─────────────────────────────────────────────────────────────

interface DraftQuestion {
  id?: string;
  lesson_id: string;
  position: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_index: 0 | 1 | 2 | 3;
  explanation: string;
}

function QuestionRow({
  question,
  onEdit,
  onDelete,
}: {
  question: QuizQuestion;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const correctLetter = (['A', 'B', 'C', 'D'] as const)[question.correct_index];
  const options = [question.option_a, question.option_b, question.option_c, question.option_d];
  return (
    <div className="card-padded">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-500">
              #{question.position}
            </span>
            <span className="rounded-full bg-aurel-teal/10 px-2 py-0.5 text-xs font-bold text-aurel-teal">
              Bonne réponse : {correctLetter}
            </span>
          </div>
          <p className="text-sm font-semibold text-aurel-ink">{question.question_text}</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {options.map((opt, i) => (
              <li key={i} className={cn(
                i === question.correct_index && 'font-semibold text-aurel-teal',
              )}>
                {(['A', 'B', 'C', 'D'] as const)[i]}. {opt}
              </li>
            ))}
          </ul>
          {question.explanation && (
            <p className="mt-2 rounded bg-slate-50 p-2 text-xs italic text-slate-500">
              💡 {question.explanation}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button onClick={onEdit} className="btn-ghost text-aurel-orange-dark" aria-label="Éditer">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={onDelete} className="btn-ghost text-red-500 hover:text-red-700" aria-label="Supprimer">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionForm({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: DraftQuestion;
  onChange: (next: DraftQuestion) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  // Validation locale avant submit. On contraint au minimum :
  // - question_text + 4 options non vides
  // - position >= 1
  const errors: string[] = [];
  if (!draft.question_text.trim()) errors.push('La question ne peut pas être vide.');
  if (!draft.option_a.trim() || !draft.option_b.trim() ||
      !draft.option_c.trim() || !draft.option_d.trim()) {
    errors.push('Les 4 options doivent être renseignées.');
  }
  if (draft.position < 1) errors.push('Position doit être ≥ 1.');

  const valid = errors.length === 0;

  return (
    <div className="card p-5 border-aurel-orange/50">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-bold text-aurel-ink">
          {draft.id ? 'Éditer la question' : 'Nouvelle question'}
        </h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Énoncé
            </label>
            <textarea
              className="input min-h-[80px] w-full"
              value={draft.question_text}
              onChange={(e) => onChange({ ...draft, question_text: e.target.value })}
              placeholder="ex : Que signifie « b.B. » ?"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Position
            </label>
            <input
              type="number"
              min={1}
              max={50}
              className="input w-full text-center"
              value={draft.position}
              onChange={(e) => onChange({ ...draft, position: Number(e.target.value) || 1 })}
            />
            <p className="mt-1 text-[10px] text-slate-400">Ordre dans le quiz.</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Options (coche la bonne réponse à droite)
          </label>
          {(['A', 'B', 'C', 'D'] as const).map((letter, i) => {
            const key = `option_${letter.toLowerCase()}` as 'option_a' | 'option_b' | 'option_c' | 'option_d';
            const isCorrect = draft.correct_index === i;
            return (
              <div key={letter} className="flex items-center gap-2">
                <span className={cn(
                  'flex h-9 w-9 flex-none items-center justify-center rounded-md font-bold',
                  isCorrect ? 'bg-aurel-teal text-white' : 'bg-slate-100 text-slate-500',
                )}>
                  {letter}
                </span>
                <input
                  className="input flex-1"
                  value={draft[key]}
                  onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
                  placeholder={`Option ${letter}`}
                />
                <label className={cn(
                  'flex cursor-pointer items-center gap-1 rounded-md border px-3 py-2 text-xs font-medium transition',
                  isCorrect
                    ? 'border-aurel-teal bg-aurel-teal/10 text-aurel-teal'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50',
                )}>
                  <input
                    type="radio"
                    name="correct_index"
                    className="sr-only"
                    checked={isCorrect}
                    onChange={() => onChange({ ...draft, correct_index: i as 0 | 1 | 2 | 3 })}
                  />
                  {isCorrect ? <><Check className="h-3.5 w-3.5" /> Correct</> : 'Correct ?'}
                </label>
              </div>
            );
          })}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Explication (optionnelle, affichée après le quiz)
          </label>
          <textarea
            className="input min-h-[60px] w-full"
            value={draft.explanation}
            onChange={(e) => onChange({ ...draft, explanation: e.target.value })}
            placeholder="ex : b.B. = bei Bedarf (à la demande)."
          />
        </div>

        {errors.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <ul className="space-y-0.5">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onCancel} className="btn-outline">Annuler</button>
          <button onClick={onSave} disabled={!valid} className="btn-primary disabled:opacity-50">
            <Check className="h-4 w-4" /> {draft.id ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

