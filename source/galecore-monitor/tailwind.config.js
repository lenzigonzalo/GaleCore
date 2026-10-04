/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontSize: {
        xs: ['14px', '20px'],
        sm: ['16px', '24px'],
        base: ['16px', '24px'],
        lg: ['20px', '28px'],
        xl: ['24px', '32px'],
        '2xl': ['30px', '36px'],
      },
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
