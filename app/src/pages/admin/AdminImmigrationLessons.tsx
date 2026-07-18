import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plane } from 'lucide-react';
import {
  adminFetchAllImmigrationLessons, adminSetImmigrationLesson,
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
      </header>

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
