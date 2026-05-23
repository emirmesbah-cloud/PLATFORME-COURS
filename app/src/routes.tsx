import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { AuthGuard } from '@/components/guards/AuthGuard';
import { AdminGuard } from '@/components/guards/AdminGuard';
import { ChunkErrorBoundary } from '@/components/guards/ChunkErrorBoundary';
import { StudentLayout } from '@/components/layout/StudentLayout';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { FullPageSpinner } from '@/components/ui/Spinner';

// Public pages — eager (small + always needed)
import { LoginPage }           from '@/pages/public/Login';
import { ActivatePage }        from '@/pages/public/Activate';
import { ForgotPasswordPage }  from '@/pages/public/ForgotPassword';
import { ResetPasswordPage }   from '@/pages/public/ResetPassword';

// Student pages — eager (the 99% path; users hit them right after login).
// Lessons + Bonus are the heaviest student pages but they're hot on first
// session. Keep eager. Certificate page imports @react-pdf inline already.
import { StudentDashboard }    from '@/pages/student/Dashboard';
import { StudentLessons }      from '@/pages/student/Lessons';
import { StudentLessonDetail } from '@/pages/student/LessonDetail';
import { StudentBonus }        from '@/pages/student/Bonus';
import { StudentProfile }      from '@/pages/student/Profile';
import { StudentCertificate }  from '@/pages/student/Certificate';
import { StudentFeedback }     from '@/pages/student/Feedback';

import { RootRedirect } from '@/components/guards/RootRedirect';

// SHERLOCK R3 perf : code-split admin routes. Avant, les 9 admin pages +
// recharts (utilisé uniquement dans AdminAnalytics) étaient bundle dans
// l'index principal → ~150 KB gzipped servis à TOUS les students sur leur
// premier chargement. Sur ISP Algérien à 200-500 kbps c'est 3-5s de
// latence en plus. Maintenant : admin/* est en chunks séparés, chargés
// uniquement quand un admin atterrit sur /admin.
//
// Les pages admin utilisent des named exports → on adapte via .then() pour
// satisfaire React.lazy qui attend `{ default: Component }`.
function lazyNamed<T extends ComponentType<any>>(
  loader: () => Promise<Record<string, ComponentType<any>>>,
  exportName: string,
) {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[exportName] as T };
  });
}

const AdminDashboard = lazyNamed(() => import('@/pages/admin/AdminDashboard'),  'AdminDashboard');
const AdminCodes     = lazyNamed(() => import('@/pages/admin/AdminCodes'),      'AdminCodes');
const AdminStudents  = lazyNamed(() => import('@/pages/admin/AdminStudents'),   'AdminStudents');
const AdminLessons   = lazyNamed(() => import('@/pages/admin/AdminLessons'),    'AdminLessons');
const AdminBonus     = lazyNamed(() => import('@/pages/admin/AdminBonus'),      'AdminBonus');
const AdminAnalytics = lazyNamed(() => import('@/pages/admin/AdminAnalytics'),  'AdminAnalytics');
const AdminFeedback  = lazyNamed(() => import('@/pages/admin/AdminFeedback'),   'AdminFeedback');
const AdminEmails    = lazyNamed(() => import('@/pages/admin/AdminEmails'),     'AdminEmails');
const AdminAudit     = lazyNamed(() => import('@/pages/admin/AdminAudit'),      'AdminAudit');

// Public unsubscribe page — lazy too, rarement utilisée et pas dans le
// flow auth principal.
const UnsubscribePage = lazyNamed(() => import('@/pages/public/Unsubscribe'), 'UnsubscribePage');

// Wrapper pour Suspense fallback uniforme sur les routes lazy.
// SHERLOCK R5 fix : ChunkErrorBoundary capture les ChunkLoadError quand
// une stale tab essaie de lazy-load un chunk dont le hash a changé après
// un deploy. Le boundary auto-reload une fois (anti-loop via sessionStorage),
// puis affiche un CTA "Recharger" si le reload n'a pas suffi.
function L({ children }: { children: React.ReactNode }) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<FullPageSpinner label="Chargement…" />}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}

export const routes: RouteObject[] = [
  { path: '/',                  element: <RootRedirect /> },
  { path: '/login',             element: <LoginPage /> },
  { path: '/activate',          element: <ActivatePage /> },
  { path: '/forgot-password',   element: <ForgotPasswordPage /> },
  { path: '/reset-password',    element: <ResetPasswordPage /> },
  { path: '/unsubscribe',       element: <L><UnsubscribePage /></L> },

  {
    path: '/',
    element: (
      <AuthGuard>
        <StudentLayout />
      </AuthGuard>
    ),
    children: [
      { path: 'dashboard',           element: <StudentDashboard /> },
      { path: 'lecons',              element: <StudentLessons /> },
      { path: 'lecons/:lessonNumber',element: <StudentLessonDetail /> },
      { path: 'bonus',               element: <StudentBonus /> },
      { path: 'certificat',          element: <StudentCertificate /> },
      { path: 'feedback',            element: <StudentFeedback /> },
      { path: 'profil',              element: <StudentProfile /> },
    ],
  },

  {
    path: '/admin',
    element: (
      <AdminGuard>
        <AdminLayout />
      </AdminGuard>
    ),
    children: [
      { index: true,         element: <L><AdminDashboard /></L> },
      { path: 'codes',       element: <L><AdminCodes /></L> },
      { path: 'students',    element: <L><AdminStudents /></L> },
      { path: 'lessons',     element: <L><AdminLessons /></L> },
      { path: 'bonus',       element: <L><AdminBonus /></L> },
      { path: 'analytics',   element: <L><AdminAnalytics /></L> },
      { path: 'feedback',    element: <L><AdminFeedback /></L> },
      { path: 'emails',      element: <L><AdminEmails /></L> },
      { path: 'audit',       element: <L><AdminAudit /></L> },
    ],
  },

  { path: '*', element: <Navigate to="/" replace /> },
];
