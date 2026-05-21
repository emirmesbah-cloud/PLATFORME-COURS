import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { fetchLessons, adminUpdateLesson, queryKeys } from '@/lib/queries';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { formatDuration } from '@/lib/utils';
import type { Lesson } from '@/lib/types';

export function AdminLessons() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: queryKeys.lessons, queryFn: fetchLessons });

  if (isLoading) return <Spinner label="Chargement..." />;
  const lessons = data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Leçons</h1>
        <p className="mt-1 text-slate-600">Renseigne le <span className="font-semibold">vdocipher_video_id</span> et active la publication pour rendre la leçon visible côté étudiant.</p>
      </header>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-12 px-4 py-3">#</th>
              <th className="px-4 py-3">Leçon</th>
              <th className="w-24 px-4 py-3">Durée</th>
              <th className="px-4 py-3">VDOCipher Video ID</th>
              <th className="w-28 px-4 py-3">Publié</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lessons.map((l) => (
              <LessonRow
                key={l.id}
                lesson={l}
                onSave={(patch) => {
                  return adminUpdateLesson(l.id, patch).then(() => {
                    qc.invalidateQueries({ queryKey: queryKeys.lessons });
                    toast.success('Leçon mise à jour.');
                  }).catch(() => toast.error('Erreur. Réessaie.'));
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LessonRow({ lesson, onSave }: { lesson: Lesson; onSave: (patch: Partial<Lesson>) => Promise<void> }) {
  const [vid, setVid] = useState(lesson.vdocipher_video_id ?? '');
  const [saving, setSaving] = useState(false);
  // SHERLOCK R14 — L4 : flag local quand le Switch is_published est en cours
  // de mutation. Avant : le user pouvait re-cliquer pendant le round-trip
  // → double-mutation, race, et UI restait avec l'ancien check pendant ~1s
  // sans feedback. Maintenant on disable + pulse anim pendant la mutation.
  const [togglingPub, setTogglingPub] = useState(false);

  async function saveVid() {
    if (vid.trim() === (lesson.vdocipher_video_id ?? '')) return;
    setSaving(true);
    await onSave({ vdocipher_video_id: vid.trim() || null });
    setSaving(false);
  }

  async function togglePublished(v: boolean) {
    if (togglingPub) return;
    setTogglingPub(true);
    try {
      await onSave({ is_published: v });
    } finally {
      setTogglingPub(false);
    }
  }

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3 font-mono text-slate-400">{String(lesson.lesson_number).padStart(2, '0')}</td>
      <td className="px-4 py-3">
        <div className="font-semibold text-aurel-ink">{lesson.title}</div>
        <div className="text-xs text-slate-500">{lesson.module_parent}</div>
      </td>
      <td className="px-4 py-3 text-slate-500">{formatDuration(lesson.duration_minutes)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            className="input w-full font-mono text-xs"
            placeholder="ex : 9d3a4b8f..."
            value={vid}
            onChange={(e) => setVid(e.target.value)}
            onBlur={saveVid}
          />
          {saving && <Loader2 className="h-4 w-4 animate-spin text-aurel-orange" />}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className={togglingPub ? 'animate-pulse' : ''}>
          <Switch checked={lesson.is_published} disabled={togglingPub} onChange={togglePublished} />
        </div>
      </td>
    </tr>
  );
}
