/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary':   'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary':  'var(--bg-tertiary)',
        'border-dark':  'var(--border-dark)',
        'text-primary': 'var(--text-primary)',
        'text-muted':   'var(--text-muted)',
        'green-gc':     'var(--green)',
        'red-gc':       'var(--red-gc)',
        'yellow-gc':    'var(--yellow-gc)',
        'blue-gc':      'var(--blue-gc)',
        'white-line':   'var(--white-line)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['DM Sans', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
