import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { fetchLessons, adminCreateLesson, adminUpdateLesson, queryKeys } from '@/lib/queries';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { formatDuration } from '@/lib/utils';
import type { Lesson } from '@/lib/types';

export function AdminLessons() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: queryKeys.lessons, queryFn: fetchLessons });
  const lessons = data ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ lesson_number: (lessons.at(-1)?.lesson_number ?? 0) + 1, title: '', subtitle: '', duration_minutes: 10, module_parent: 'Nouveau module', phase: 'Formation', order_index: (lessons.at(-1)?.order_index ?? 0) + 1, vdocipher_video_id: '', is_published: false });

  async function createLesson() {
    if (!draft.title.trim()) return toast.error('Le titre est obligatoire.');
    if (!window.confirm(`Ajouter la leçon Pflege « ${draft.title} » ?`)) return;
    try { await adminCreateLesson({ ...draft, title: draft.title.trim(), subtitle: draft.subtitle.trim(), vdocipher_video_id: draft.vdocipher_video_id.trim() || null }); await qc.invalidateQueries({ queryKey: queryKeys.lessons }); setAdding(false); toast.success('Leçon Pflege ajoutée.'); } catch (e) { toast.error(e instanceof Error ? e.message : 'Ajout impossible.'); }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
        <h1 className="text-3xl font-bold text-aurel-ink">Leçons</h1>
        <p className="mt-1 text-slate-600">Renseigne le <span className="font-semibold">vdocipher_video_id</span> et active la publication pour rendre la leçon visible côté étudiant.</p>
        </div><button className="btn-primary" onClick={() => setAdding(!adding)}><Plus className="h-4 w-4" /> Ajouter une leçon Pflege</button>
      </header>

      {adding && <section className="card-padded grid gap-3 md:grid-cols-3"><input className="input" type="number" value={draft.lesson_number} onChange={(e) => setDraft({ ...draft, lesson_number: Number(e.target.value) })} placeholder="Numéro" /><input className="input md:col-span-2" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Titre" /><input className="input" value={draft.module_parent} onChange={(e) => setDraft({ ...draft, module_parent: e.target.value })} placeholder="Module" /><input className="input" type="number" value={draft.duration_minutes} onChange={(e) => setDraft({ ...draft, duration_minutes: Number(e.target.value) })} placeholder="Durée" /><input className="input" value={draft.vdocipher_video_id} onChange={(e) => setDraft({ ...draft, vdocipher_video_id: e.target.value })} placeholder="VDOCipher ID" /><div className="md:col-span-3 flex gap-2"><button className="btn-primary" onClick={createLesson}>Oui, ajouter</button><button className="btn-outline" onClick={() => setAdding(false)}>Non, annuler</button></div></section>}

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
            {isLoading && lessons.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-4 py-3"><div className="h-3 w-6 rounded bg-slate-200" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-2/3 rounded bg-slate-200" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-12 rounded bg-slate-100" /></td>
                    <td className="px-4 py-3"><div className="h-8 w-full rounded bg-slate-100" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-10 rounded bg-slate-200" /></td>
                  </tr>
                ))
              : lessons.map((l) => (
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
