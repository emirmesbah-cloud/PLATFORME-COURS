import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, RotateCcw, Trophy, BookOpen, ArrowRight, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  fetchImmigrationQuiz, submitImmigrationQuiz,
  type ImmigrationQuizResult, type ImmigrationQuizQuestionStudent,
} from '@/lib/immigration';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

/**
 * ImmigrationQuiz — quiz shown under an Immigration lesson.
 * Mirrors the Pflege LessonQuiz : one question at a time, server-side scoring
 * (submit_immigration_quiz_attempt), 3/5 threshold, unlimited retries.
 * Renders nothing if the lesson has no questions seeded.
 */
export function ImmigrationQuiz({ lessonSlug, onPassed }: { lessonSlug: string; onPassed?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: questions, isLoading, isError, refetch } = useQuery({
    queryKey: ['immigration-quiz', lessonSlug],
    queryFn: () => fetchImmigrationQuiz(lessonSlug),
    staleTime: 5 * 60 * 1000,
  });

  const [answers, setAnswers] = useState<number[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImmigrationQuizResult | null>(null);

  const total = questions?.length ?? 0;
  useMemo(() => {
    if (total > 0 && answers.length !== total) setAnswers(new Array(total).fill(-1));
  }, [total, answers.length]);

  if (isLoading) {
    return (
      <div className="card-padded animate-pulse">
        <div className="mb-3 h-4 w-32 rounded bg-zinc-200" />
        <div className="space-y-2">{[1,2,3,4].map((i) => <div key={i} className="h-10 rounded bg-zinc-100" />)}</div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="card-padded flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <div>
          <p className="font-semibold text-zinc-900">Le quiz n'a pas pu charger</p>
          <p className="mt-1 text-sm text-zinc-600">Vérifie ta connexion puis réessaie.</p>
        </div>
        <button onClick={() => refetch()} className="btn-primary">
          <RefreshCw className="h-4 w-4" /> Réessayer
        </button>
      </div>
    );
  }
  if (!questions || questions.length === 0) return null;

  if (result && result.ok) {
    return <Result result={result} questions={questions} userAnswers={answers}
      onRetry={() => { setResult(null); setAnswers(new Array(questions.length).fill(-1)); setCurrentIdx(0); }} />;
  }

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
    setAnswers((prev) => { const n = [...prev]; n[currentIdx] = idx; return n; });
  }

  async function handleSubmit() {
    if (!allAnswered) { toast.error('Réponds à toutes les questions avant de valider.'); return; }
    setSubmitting(true);
    try {
      const r = await submitImmigrationQuiz(lessonSlug, answers);
      setResult(r);
      if (r.ok && r.passed) {
        toast.success(`Bravo ! ${r.score}/${r.total} — leçon validée.`);
        qc.invalidateQueries({ queryKey: ['immigration-status'] });
        onPassed?.();
      } else if (r.ok) {
        toast.info(`Score : ${r.score}/${r.total}. Il te faut ${r.threshold}/${r.total} pour valider.`);
      } else {
        toast.error(r.error || 'Erreur lors de la soumission.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between bg-aurel-orange/10 px-5 py-3">
        <div className="flex items-center gap-2 text-aurel-orange-dark">
          <BookOpen className="h-4 w-4" />
          <span className="text-sm font-semibold">Quiz de la leçon</span>
        </div>
        <span className="font-mono text-[11px] text-zinc-500">Question {currentIdx + 1} / {questions.length}</span>
      </div>

      <div className="flex items-center justify-center gap-1.5 px-5 pt-4">
        {questions.map((_, i) => (
          <button key={i} onClick={() => setCurrentIdx(i)} aria-label={`Question ${i + 1}`}
            className={cn('h-2 rounded-full transition-all',
              i === currentIdx ? 'w-6 bg-aurel-orange' : answers[i] !== -1 ? 'w-2 bg-aurel-teal' : 'w-2 bg-zinc-200')} />
        ))}
      </div>

      <div className="p-5">
        <p className="mb-4 text-base font-semibold text-zinc-900">{q.question_text}</p>
        <div className="space-y-2">
          {options.map((opt) => {
            const isPicked = selected === opt.index;
            return (
              <button key={opt.key} onClick={() => pick(opt.index)}
                className={cn('w-full rounded-card-sm border px-4 py-3 text-left text-sm transition',
                  isPicked ? 'border-aurel-orange bg-aurel-orange/10 text-zinc-900 ring-1 ring-aurel-orange'
                           : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50')}>
                <span className={cn('mr-3 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                  isPicked ? 'bg-aurel-orange text-white' : 'bg-zinc-100 text-zinc-500')}>{opt.key}</span>
                {opt.text}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))} disabled={currentIdx === 0}
            className="btn-outline disabled:opacity-40 disabled:cursor-not-allowed">Précédent</button>
          {isLast ? (
            <button onClick={handleSubmit} disabled={!allAnswered || submitting}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? 'Envoi…' : 'Valider mes réponses'}
            </button>
          ) : (
            <button onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))} disabled={selected === -1}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              Suivant <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
        {!allAnswered && isLast && (
          <p className="mt-3 text-xs text-amber-600">Réponds à toutes les questions avant de valider.</p>
        )}
      </div>
    </div>
  );
}

function Result({ result, questions, userAnswers, onRetry }: {
  result: ImmigrationQuizResult;
  questions: ImmigrationQuizQuestionStudent[];
  userAnswers: number[];
  onRetry: () => void;
}) {
  const passed = result.passed === true;
  const score = result.score ?? 0;
  const total = result.total ?? 0;
  const threshold = result.threshold ?? Math.ceil(total * 0.6);
  const correct = result.correct ?? [];
  const hasDetailedCorrections = correct.length === questions.length;

  return (
    <div className="card overflow-hidden">
      <div className={cn('flex items-center justify-between px-5 py-4',
        passed ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900')}>
        <div className="flex items-center gap-2">
          {passed ? <Trophy className="h-5 w-5 text-green-600" /> : <RotateCcw className="h-5 w-5 text-amber-600" />}
          <span className="text-base font-bold">{passed ? 'Quiz réussi !' : 'Pas encore validé'}</span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold tabular">{score} / {total}</div>
          <div className="text-xs">Seuil : {threshold} / {total}</div>
        </div>
      </div>

      <div className="space-y-3 p-5">
        {hasDetailedCorrections ? questions.map((q, i) => {
          const userPick = userAnswers[i];
          const goodIdx = correct[i];
          const isGood = userPick === goodIdx;
          const opts = [q.option_a, q.option_b, q.option_c, q.option_d];
          return (
            <div key={q.id} className={cn('rounded-card-sm border p-3 text-sm',
              isGood ? 'border-green-200 bg-green-50/40' : 'border-red-200 bg-red-50/40')}>
              <div className="mb-1 flex items-start gap-2 font-semibold text-zinc-900">
                {isGood ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-green-600" />
                        : <XCircle className="mt-0.5 h-4 w-4 flex-none text-red-600" />}
                <span>{i + 1}. {q.question_text}</span>
              </div>
              <div className="ml-6 mt-1 space-y-0.5 text-xs">
                {!isGood && userPick >= 0 && (
                  <div className="text-red-700">Ta réponse : <span className="font-semibold">{opts[userPick]}</span></div>
                )}
                <div className="text-green-700">Bonne réponse : <span className="font-semibold">{opts[goodIdx]}</span></div>
              </div>
            </div>
          );
        }) : (
          <div className="rounded-card-sm border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
            <div className="flex items-start gap-2">
              <BookOpen className="mt-0.5 h-4 w-4 flex-none text-aurel-orange" />
              <div>
                <p className="font-semibold text-zinc-900">Résultat enregistré</p>
                <p className="mt-1">
                  Les réponses exactes ne sont pas affichées. Revois la leçon, puis recommence le quiz pour améliorer ton score.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50 px-5 py-3">
        <p className={cn('text-sm', passed ? 'text-green-700' : 'text-amber-700')}>
          {passed ? '✨ Leçon validée. Continue !' : 'Revois la vidéo, puis réessaie. Réessais illimités.'}
        </p>
        <button onClick={onRetry} className={passed ? 'btn-outline' : 'btn-primary'}>
          <RotateCcw className="h-4 w-4" /> Recommencer
        </button>
      </div>
    </div>
  );
}
