import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plane, Plus } from 'lucide-react';
import {
  adminFetchAllImmigrationLessons, adminSetImmigrationLesson,
  adminCreateImmigrationLesson,
  type ImmigrationLessonMedia,
} from '@/lib/immigration';
import { IMMIGRATION_SECTIONS } from '@/data/immigration-structure';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';

/**
 * AdminImmigrationLessons — mirror of AdminLessons (Pflege) for the Immigration
 * course. Lists all 61 lessons grouped by section/module ; per lesson the admin
 * pastes the VDOCipher video id + toggles "Publié". Persisted in the
 * immigration_lessons table (mig 035) via admin_set_immigration_lesson.
 *
 * The student reader shows the video only when is_published = true AND a video
 * id is present — so the admin can pre-fill ids now and flip "Publié" later.
 */
export function AdminImmigrationLessons() {
  const qc = useQueryClient();
  const toast = useToast();

  const mediaQ = useQuery({
    queryKey: ['admin-immigration-lessons'],
    queryFn: adminFetchAllImmigrationLessons,
  });

  // slug → media row, for quick merge with the static lesson tree.
  const bySlug = useMemo(() => {
    const m = new Map<string, ImmigrationLessonMedia>();
    for (const row of mediaQ.data ?? []) m.set(row.lesson_slug, row);
    return m;
  }, [mediaQ.data]);

  const publishedCount = (mediaQ.data ?? []).filter((r) => r.is_published && r.vdocipher_video_id).length;
  const withVideo = (mediaQ.data ?? []).filter((r) => r.vdocipher_video_id).length;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ lesson_slug: '', title: '', module_slug: 'module-11', lesson_number_label: '11.1', duration_label: '8–10 min', order_index: 1000, vdocipher_video_id: '', is_published: false });

  async function createLesson() {
    if (!draft.lesson_slug.trim() || !draft.title.trim()) return toast.error('Slug et titre obligatoires.');
    if (!window.confirm(`Ajouter la leçon Immigration « ${draft.title} » ?`)) return;
    try { await adminCreateImmigrationLesson({ ...draft, lesson_slug: draft.lesson_slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'), title: draft.title.trim(), vdocipher_video_id: draft.vdocipher_video_id.trim() || null }); await qc.invalidateQueries({ queryKey: ['admin-immigration-lessons'] }); setAdding(false); toast.success('Leçon Immigration ajoutée.'); } catch (e) { toast.error(e instanceof Error ? e.message : 'Ajout impossible.'); }
  }

  async function save(lessonSlug: string, videoId: string | null, published: boolean) {
    await adminSetImmigrationLesson(lessonSlug, videoId, published);
    qc.invalidateQueries({ queryKey: ['admin-immigration-lessons'] });
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <Plane className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Leçons · Immigration</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink">Leçons — cours Immigration</h1>
        <p className="mt-1 text-slate-600">
          Colle le <span className="font-semibold">VDOCipher Video ID</span> et active <span className="font-semibold">Publié</span> pour rendre la vidéo visible côté étudiant.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          <span className="font-mono font-semibold text-aurel-teal">{withVideo}</span> leçon(s) avec ID vidéo ·{' '}
          <span className="font-mono font-semibold text-green-600">{publishedCount}</span> publiée(s).
        </p>
        <button className="btn-primary mt-4" onClick={() => setAdding(!adding)}><Plus className="h-4 w-4" /> Ajouter une leçon Immigration</button>
      </header>

      {adding && <section className="card-padded grid gap-3 md:grid-cols-3"><input className="input" value={draft.lesson_number_label} onChange={(e) => setDraft({ ...draft, lesson_number_label: e.target.value })} placeholder="Numéro, ex. 11.1" /><input className="input md:col-span-2" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Titre" /><input className="input" value={draft.module_slug} onChange={(e) => setDraft({ ...draft, module_slug: e.target.value })} placeholder="Module, ex. module-11" /><input className="input" value={draft.lesson_slug} onChange={(e) => setDraft({ ...draft, lesson_slug: e.target.value })} placeholder="Lien/slug unique" /><input className="input" value={draft.duration_label} onChange={(e) => setDraft({ ...draft, duration_label: e.target.value })} placeholder="Durée" /><input className="input md:col-span-2" value={draft.vdocipher_video_id} onChange={(e) => setDraft({ ...draft, vdocipher_video_id: e.target.value })} placeholder="VDOCipher ID" /><label className="flex items-center gap-2"><input type="checkbox" checked={draft.is_published} onChange={(e) => setDraft({ ...draft, is_published: e.target.checked })} /> Publier immédiatement</label><div className="md:col-span-3 flex gap-2"><button className="btn-primary" onClick={createLesson}>Oui, ajouter</button><button className="btn-outline" onClick={() => setAdding(false)}>Non, annuler</button></div></section>}

      {IMMIGRATION_SECTIONS.map((section) => (
        <div key={section.slug} className="card overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {section.title}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="w-16 px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">Leçon</th>
                  <th className="px-4 py-2.5">VDOCipher Video ID</th>
                  <th className="w-24 px-4 py-2.5">Publié</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {section.modules.map((mod) => (
                  <ModuleGroup key={mod.slug} moduleTitle={mod.title}>
                    {mod.lessons.map((l) => {
                      const media = bySlug.get(l.slug);
                      return (
                        <LessonRow
                          key={l.slug}
                          id={l.id}
                          title={l.title}
                          slug={l.slug}
                          initialVideoId={media?.vdocipher_video_id ?? ''}
                          published={media?.is_published ?? false}
                          loading={mediaQ.isLoading}
                          onSave={save}
                          onError={() => toast.error('Erreur. Réessaie.')}
                          onSaved={() => toast.success('Leçon mise à jour.')}
                        />
                      );
                    })}
                  </ModuleGroup>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {(mediaQ.data ?? []).filter((row) => row.is_custom).length > 0 && <div className="card overflow-hidden"><div className="border-b bg-aurel-orange-soft px-4 py-3 text-sm font-bold text-aurel-orange-dark">Leçons ajoutées récemment</div><div className="divide-y">{(mediaQ.data ?? []).filter((row) => row.is_custom).map((row) => <div key={row.lesson_slug} className="grid gap-2 p-4 md:grid-cols-[100px_1fr_240px]"><span className="font-mono text-xs text-slate-500">{row.lesson_number_label}</span><div><div className="font-semibold">{row.title}</div><div className="text-xs text-slate-500">{row.module_slug} · {row.duration_label}</div></div><span className={row.is_published ? 'text-sm text-green-600' : 'text-sm text-amber-600'}>{row.is_published ? 'Publiée' : 'Brouillon'}</span></div>)}</div></div>}
    </div>
  );
}

function ModuleGroup({ moduleTitle, children }: { moduleTitle: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-slate-50/60">
        <td colSpan={4} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {moduleTitle}
        </td>
      </tr>
      {children}
    </>
  );
}

function LessonRow({
  id, title, slug, initialVideoId, published, loading, onSave, onSaved, onError,
}: {
  id: string;
  title: string;
  slug: string;
  initialVideoId: string;
  published: boolean;
  loading: boolean;
  onSave: (slug: string, videoId: string | null, published: boolean) => Promise<void>;
  onSaved: () => void;
  onError: () => void;
}) {
  const [vid, setVid] = useState(initialVideoId);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  // The rows mount before the async media query finishes. Keep the input in
  // sync when its saved VDOCipher ID arrives (or changes after a refetch).
  useEffect(() => {
    setVid(initialVideoId);
  }, [initialVideoId]);

  async function saveVid() {
    if (vid.trim() === initialVideoId) return;
    setSaving(true);
    try {
      await onSave(slug, vid.trim() || null, published);
      onSaved();
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  }

  async function togglePublished(v: boolean) {
    if (toggling) return;
    setToggling(true);
    try {
      await onSave(slug, vid.trim() || null, v);
      onSaved();
    } catch {
      onError();
    } finally {
      setToggling(false);
    }
  }

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{id}</td>
      <td className="px-4 py-2.5">
        <div className="font-medium text-aurel-ink">{title}</div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <input
            className="input w-full font-mono text-xs"
            placeholder="ex : 9d3a4b8f0e1c..."
            value={vid}
            disabled={loading}
            onChange={(e) => setVid(e.target.value)}
            onBlur={saveVid}
          />
          {saving && <Loader2 className="h-4 w-4 animate-spin text-aurel-orange" />}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className={toggling ? 'animate-pulse' : ''}>
          <Switch checked={published} disabled={toggling || loading} onChange={togglePublished} />
        </div>
      </td>
    </tr>
  );
}
