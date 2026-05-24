/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Aurel brand — Linear Tech direction with Aurel palette
        aurel: {
          orange:        '#F97316',
          'orange-dark': '#EA580C',
          'orange-soft': '#FFEDD5',
          teal:          '#0D7377',
          'teal-dark':   '#0A5C5F',
          'teal-soft':   '#E0F2F1',
          dark:          '#0A1628',
          ink:           '#1A1A1A',
        },
        // Linear Tech neutral palette — used for cards, borders, soft bgs
        zinc: {
          50:  '#FAFAFA',
          100: '#F4F4F5',
          200: '#E4E4E7',
          400: '#A1A1AA',
          500: '#71717A',
          600: '#52525B',
          900: '#18181B',
          950: '#09090B',
        },
      },
      fontFamily: {
        // Geist (variable, 300-700) — primary UI typeface.
        // Falls back to Inter / system if Geist hasn't loaded yet (no FOUT).
        sans: ['Geist', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Geist Mono', 'JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        serif: ['Georgia', 'Times New Roman', 'serif'],
      },
      fontSize: {
        // Custom display sizes for hero headlines (used in Dashboard hero card)
        'display-sm': ['28px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display':    ['38px', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
        'display-lg': ['56px', { lineHeight: '1', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        // Linear Tech uses softer corners than typical Tailwind defaults.
        // We expose 'card' (default for our card components) and 'pill' (badges).
        'card': '12px',
        'card-sm': '8px',
        'pill': '100px',
      },
      boxShadow: {
        // Subtle elevations matching the Linear Tech vibe.
        'card':       '0 1px 2px 0 rgba(0, 0, 0, 0.04)',
        'card-hover': '0 4px 12px 0 rgba(0, 0, 0, 0.06)',
        'modal':      '0 24px 48px -12px rgba(0, 0, 0, 0.2)',
        // Hero card glow — used in Dashboard with orange-soft
        'glow-orange': '0 8px 32px -8px rgba(249, 115, 22, 0.18)',
      },
      keyframes: {
        'fade-in':  { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        // Subtle pulse for "live" indicator dots
        'pulse-dot': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
      },
      animation: {
        'fade-in':   'fade-in 0.2s ease-out',
        'slide-up':  'slide-up 0.25s ease-out',
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
