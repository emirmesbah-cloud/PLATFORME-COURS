import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, RotateCcw, Trophy, BookOpen, ArrowRight } from 'lucide-react';
import {
  fetchQuizQuestionsForStudent,
  submitQuizAttempt,
  queryKeys,
} from '@/lib/queries';
import type { QuizSubmissionResult } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

/**
 * LessonQuiz — affiche le quiz d'une leçon après la vidéo.
 * Comportement :
 *  - Une question à la fois, navigation Précédent / Suivant.
 *  - On ne valide que lorsque toutes les questions ont une réponse sélectionnée.
 *  - Score calculé SERVEUR (RPC submit_quiz_attempt) → aucune triche possible.
 *  - Seuil de réussite : 60 % (3/5).
 *  - Réessais illimités (bouton "Recommencer").
 *  - Si la leçon n'a pas de quiz seedé → on n'affiche rien (le verrouillage
 *    retombe alors sur lesson_progress.completed côté backend).
 */
export function LessonQuiz({
  lessonId,
  lessonNumber,
  onPassed,
}: {
  lessonId: string;
  lessonNumber: number;
  onPassed?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: questions, isLoading, isError } = useQuery({
    queryKey: queryKeys.quizQuestionsStudent(lessonId),
    queryFn: () => fetchQuizQuestionsForStudent(lessonId),
    staleTime: 5 * 60 * 1000, // questions ne bougent quasi-jamais
  });

  // Index de l'option sélectionnée par l'utilisateur pour chaque question.
  // -1 = pas encore répondu.
  const [answers, setAnswers] = useState<number[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuizSubmissionResult | null>(null);

  // (Re)initialize answers array when questions change.
  const total = questions?.length ?? 0;
  useMemo(() => {
    if (total > 0 && answers.length !== total) {
      setAnswers(new Array(total).fill(-1));
    }
  }, [total, answers.length]);

  if (isLoading) {
    return (
      <div className="card-padded animate-pulse">
        <div className="mb-3 h-4 w-32 rounded bg-slate-200" />
        <div className="mb-2 h-6 w-3/4 rounded bg-slate-200" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="card-padded text-sm text-slate-500">
        Impossible de charger le quiz. Recharge la page.
      </div>
    );
  }

  // No questions seeded for this lesson — on ne montre rien (lesson 1, 2,
  // ou lesson pas encore quizzée par l'admin).
  if (!questions || questions.length === 0) return null;

  // ── Résultat affiché après soumission ────────────────────────────────
  if (result && result.ok) {
    return <QuizResult
      result={result}
      questions={questions}
      userAnswers={answers}
      onRetry={() => {
        setResult(null);
        setAnswers(new Array(questions.length).fill(-1));
        setCurrentIdx(0);
      }}
    />;
  }

  // ── Quiz en cours ────────────────────────────────────────────────────
  const q = questions[currentIdx];
  const options = [
    { key: 'A', text: q.option_a, index: 0 },
    { key: 'B', text: q.option_b, index: 1 },
    { key: 'C', text: q.option_c, index: 2 },
    { key: 'D', text: q.option_d, index: 3 },
  ];
  const selected = answers[currentIdx];
  const allAnswered = answers.every((a) => a !== -1);
  const isLast = currentIdx === questions.length - 1;

  function pick(idx: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[currentIdx] = idx;
      return next;
    });
  }

  async function handleSubmit() {
    if (!allAnswered) {
      toast.error('Réponds à toutes les questions avant de valider.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await submitQuizAttempt(lessonId, answers);
      setResult(r);
      if (r.ok && r.passed) {
        toast.success(`Bravo ! ${r.score}/${r.total} — leçon validée.`);
        // Le déverrouillage de la suivante dépend de l'état du quiz_status.
        qc.invalidateQueries({ queryKey: ['quiz_status'] });
        qc.invalidateQueries({ queryKey: ['quiz_questions'] });
        onPassed?.();
      } else if (r.ok && !r.passed) {
        toast.info(`Score : ${r.score}/${r.total}. Il te faut ${r.threshold}/${r.total} pour valider.`);
      } else {
        toast.error(r.error || 'Erreur lors de la soumission.');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur réseau.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between bg-aurel-orange/10 px-5 py-3">
        <div className="flex items-center gap-2 text-aurel-orange-dark">
          <BookOpen className="h-4 w-4" />
          <span className="text-sm font-semibold">Quiz — Leçon {lessonNumber}</span>
        </div>
        <span className="text-xs font-mono text-slate-500">
          Question {currentIdx + 1} / {questions.length}
        </span>
      </div>

      {/* Progression dots */}
      <div className="flex items-center justify-center gap-1.5 px-5 pt-4">
        {questions.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentIdx(i)}
            className={cn(
              'h-2 w-2 rounded-full transition',
              i === currentIdx ? 'bg-aurel-orange w-6'
                : answers[i] !== -1 ? 'bg-aurel-teal'
                : 'bg-slate-200',
            )}
            aria-label={`Aller à la question ${i + 1}`}
          />
        ))}
      </div>

      <div className="p-5">
        <p className="mb-4 text-base font-semibold text-aurel-ink">
          {q.question_text}
        </p>
        <div className="space-y-2">
          {options.map((opt) => {
            const isPicked = selected === opt.index;
            return (
              <button
                key={opt.key}
                onClick={() => pick(opt.index)}
                className={cn(
                  'w-full rounded-lg border px-4 py-3 text-left text-sm transition',
                  isPicked
                    ? 'border-aurel-orange bg-aurel-orange/10 text-aurel-ink ring-1 ring-aurel-orange'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <span className={cn(
                  'mr-3 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                  isPicked ? 'bg-aurel-orange text-white' : 'bg-slate-100 text-slate-500',
                )}>
                  {opt.key}
                </span>
                {opt.text}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            disabled={currentIdx === 0}
            className="btn-outline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Précédent
          </button>

          {isLast ? (
            <button
              onClick={handleSubmit}
              disabled={!allAnswered || submitting}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Envoi…' : 'Valider mes réponses'}
            </button>
          ) : (
            <button
              onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
              disabled={selected === -1}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Suivant <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>

        {!allAnswered && isLast && (
          <p className="mt-3 text-xs text-amber-600">
            Tu dois répondre à toutes les questions avant de valider.
          </p>
        )}
      </div>
    </div>
  );
}


/**
 * QuizResult — vue de résultat après soumission.
 * Montre score, seuil, et corrige question par question (avec explication).
 */
function QuizResult({
  result,
  questions,
  userAnswers,
  onRetry,
}: {
  result: QuizSubmissionResult;
  questions: Awaited<ReturnType<typeof fetchQuizQuestionsForStudent>>;
  userAnswers: number[];
  onRetry: () => void;
}) {
  const passed = result.passed === true;
  const score = result.score ?? 0;
  const total = result.total ?? 0;
  const threshold = result.threshold ?? Math.ceil(total * 0.6);
  const correct = result.correct ?? [];

  return (
    <div className="card overflow-hidden">
      <div className={cn(
        'flex items-center justify-between px-5 py-4',
        passed ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900',
      )}>
        <div className="flex items-center gap-2">
          {passed
            ? <Trophy className="h-5 w-5 text-green-600" />
            : <RotateCcw className="h-5 w-5 text-amber-600" />}
          <span className="text-base font-bold">
            {passed ? 'Quiz réussi !' : 'Pas encore validé'}
          </span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold">{score} / {total}</div>
          <div className="text-xs">Seuil : {threshold} / {total}</div>
        </div>
      </div>

      <div className="space-y-3 p-5">
        {questions.map((q, i) => {
          const userPick = userAnswers[i];
          const goodIdx = correct[i];
          const isGood = userPick === goodIdx;
          const options = [q.option_a, q.option_b, q.option_c, q.option_d];
          return (
            <div key={q.id} className={cn(
              'rounded-lg border p-3 text-sm',
              isGood ? 'border-green-200 bg-green-50/40' : 'border-red-200 bg-red-50/40',
            )}>
              <div className="mb-1 flex items-start gap-2 font-semibold text-aurel-ink">
                {isGood
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-green-600" />
                  : <XCircle className="mt-0.5 h-4 w-4 flex-none text-red-600" />}
                <span>{i + 1}. {q.question_text}</span>
              </div>
              <div className="ml-6 mt-1 space-y-0.5 text-xs">
                {!isGood && userPick !== undefined && userPick >= 0 && (
                  <div className="text-red-700">
                    Ta réponse : <span className="font-semibold">{options[userPick]}</span>
                  </div>
                )}
                <div className="text-green-700">
                  Bonne réponse : <span className="font-semibold">{options[goodIdx]}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-5 py-3">
        {passed ? (
          <p className="text-sm text-green-700">
            ✨ Tu as débloqué la leçon suivante. Continue ton parcours !
          </p>
        ) : (
          <p className="text-sm text-amber-700">
            Revois la vidéo si besoin, puis réessaie. Réessais illimités.
          </p>
        )}
        <button onClick={onRetry} className={passed ? 'btn-outline' : 'btn-primary'}>
          <RotateCcw className="h-4 w-4" /> Recommencer
        </button>
      </div>
    </div>
  );
}

