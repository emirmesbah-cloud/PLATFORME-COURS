/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Aurel brand
        aurel: {
          orange:  '#F97316',
          'orange-dark': '#EA580C',
          'orange-soft': '#FFEDD5',
          teal:    '#0D7377',
          'teal-dark': '#0A5C5F',
          dark:    '#0A1628',
          ink:     '#1A1A1A',
        },
      },
      fontFamily: {
        sans: ['Calibri', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Georgia', 'Times New Roman', 'serif'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'fade-in':  'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.25s ease-out',
      },
    },
  },
  plugins: [],
};
