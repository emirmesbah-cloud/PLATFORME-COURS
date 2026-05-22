import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';

/**
 * DisclaimerGuard — wraps ONLY lesson-watching routes (/lecons/:lessonNumber).
 *
 * Why scoped to lesson detail (and not whole app) :
 *   The user explicitly wanted dashboard / profile / bonus / certificate to
 *   remain freely accessible. The disclaimer is a legal precondition to
 *   WATCHING course content, not to logging in. So we gate the lesson detail
 *   page (which is what plays the video) instead of every authenticated route.
 *
 * Behavior when blocked :
 *   Renders an explanatory locked-view card instead of the lesson player.
 *   The student stays on /lecons/:n in the URL bar (so back-button works)
 *   but sees an explanation + a CTA button to go acknowledge the disclaimer.
 *   This is the "Modal popup" UX choice from the design questions — but
 *   implemented as a full-page card so it works on mobile, plays nice with
 *   the back button, and doesn't fight z-index with any toast/notification.
 *
 * Admins are exempt (auto-acked at migration time).
 * Defense in depth : update_lesson_progress() also rejects writes from
 * un-ack'd users — so even if a malicious client bypasses this UI, no
 * progress can be saved against any lesson.
 */
export function DisclaimerGuard({ children }: { children: ReactNode }) {
  const { profile } = useAuth();

  // Profile load race — let the upstream AuthGuard handle.
  if (!profile) return <>{children}</>;

  // Admins always exempt.
  if (profile.is_admin) return <>{children}</>;

  // Already acknowledged → render the lesson normally.
  if (profile.disclaimer_acknowledged_at) return <>{children}</>;

  // Locked : render explanation + CTA. URL stays on /lecons/:n so back-button
  // works as expected. Lives inside StudentLayout's <Outlet /> so the nav bar
  // is still visible above.
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-aurel-orange/30 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-aurel-orange/15">
          <AlertTriangle className="h-7 w-7 text-aurel-orange" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-aurel-ink md:text-2xl">
          Disclaimer obligatoire
        </h2>
        <p className="mb-6 text-sm text-slate-600">
          Tu dois d'abord regarder le disclaimer en intégralité avant d'accéder à tes leçons.
          C'est une étape obligatoire — une fois faite, tu n'auras plus jamais à la refaire.
        </p>
        <Link
          to="/disclaimer"
          className="btn-primary inline-flex w-full items-center justify-center gap-2"
        >
          Regarder le disclaimer maintenant <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          to="/dashboard"
          className="mt-3 inline-block text-sm text-slate-500 hover:text-aurel-orange-dark hover:underline"
        >
          ← Retour au dashboard
        </Link>
      </div>
    </div>
  );
}
