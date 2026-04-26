import { Navigate, type RouteObject } from 'react-router-dom';
import { AuthGuard } from '@/components/guards/AuthGuard';
import { AdminGuard } from '@/components/guards/AdminGuard';
import { StudentLayout } from '@/components/layout/StudentLayout';
import { AdminLayout } from '@/components/layout/AdminLayout';

import { LoginPage }           from '@/pages/public/Login';
import { ActivatePage }        from '@/pages/public/Activate';
import { ForgotPasswordPage }  from '@/pages/public/ForgotPassword';

import { StudentDashboard }    from '@/pages/student/Dashboard';
import { StudentLessons }      from '@/pages/student/Lessons';
import { StudentLessonDetail } from '@/pages/student/LessonDetail';
import { StudentBonus }        from '@/pages/student/Bonus';
import { StudentProfile }      from '@/pages/student/Profile';

import { AdminDashboard }      from '@/pages/admin/AdminDashboard';
import { AdminCodes }          from '@/pages/admin/AdminCodes';
import { AdminStudents }       from '@/pages/admin/AdminStudents';
import { AdminLessons }        from '@/pages/admin/AdminLessons';
import { AdminBonus }          from '@/pages/admin/AdminBonus';

import { RootRedirect } from '@/components/guards/RootRedirect';

export const routes: RouteObject[] = [
  { path: '/',                  element: <RootRedirect /> },
  { path: '/login',             element: <LoginPage /> },
  { path: '/activate',          element: <ActivatePage /> },
  { path: '/forgot-password',   element: <ForgotPasswordPage /> },

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
      { index: true,         element: <AdminDashboard /> },
      { path: 'codes',       element: <AdminCodes /> },
      { path: 'students',    element: <AdminStudents /> },
      { path: 'lessons',     element: <AdminLessons /> },
      { path: 'bonus',       element: <AdminBonus /> },
    ],
  },

  { path: '*', element: <Navigate to="/" replace /> },
];
