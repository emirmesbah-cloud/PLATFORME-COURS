import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { initSentry, SentryErrorBoundary } from '@/lib/sentry';

// Init Sentry AVANT tout React render → capture les erreurs d'init aussi
initSentry();

function FallbackError({ error, resetError }: { error: unknown; resetError: () => void }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: '#FFF8F1',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        maxWidth: '480px',
        background: '#fff',
        border: '1px solid #E8E0D0',
        borderRadius: '16px',
        padding: '32px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>😬</div>
        <h1 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px' }}>
          Une erreur s'est produite
        </h1>
        <p style={{ color: '#6B7280', fontSize: '14px', marginBottom: '24px' }}>
          On a été notifié. Tu peux essayer de rafraîchir ou revenir à l'accueil.
        </p>
        <button
          onClick={resetError}
          style={{
            background: '#F97316',
            color: '#fff',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '10px',
            fontWeight: 700,
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Réessayer
        </button>
        {import.meta.env.DEV && error instanceof Error && (
          <pre style={{
            marginTop: '24px',
            padding: '12px',
            background: '#F5F5F5',
            borderRadius: '8px',
            fontSize: '11px',
            textAlign: 'left',
            overflow: 'auto',
            maxHeight: '200px',
          }}>
            {error.message}
            {'\n'}
            {error.stack}
          </pre>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SentryErrorBoundary fallback={FallbackError} showDialog={false}>
      <App />
    </SentryErrorBoundary>
  </React.StrictMode>
);
