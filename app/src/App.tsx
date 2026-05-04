import { useEffect } from 'react';
import { BrowserRouter, useLocation, useRoutes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import { ToastProvider } from '@/components/ui/Toast';
import { PWAUpdatePrompt } from '@/components/features/PWAUpdatePrompt';
import { KickedListener } from '@/components/features/KickedListener';
import { routes } from '@/routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function AppRoutes() {
  // SHERLOCK R6 fix : scroll-to-top on route change. react-router v6 with
  // useRoutes() doesn't provide automatic restoration ; without this, a long
  // /lecons list scrolled to lesson 12 → click lesson 12 → /lecons/12 opens
  // scrolled mid-page. Mobile UX especially confusing.
  // We use 'auto' (instant) instead of smooth — feels more like a fresh page.
  const { pathname } = useLocation();
  useEffect(() => {
    // Defer to next tick so the new route's content is in the DOM first.
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, [pathname]);
  return useRoutes(routes);
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <KickedListener />
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
            <PWAUpdatePrompt />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
