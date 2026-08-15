/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0a0e14',
        surface: '#11161f',
        'surface-2': '#161c27',
        border: '#222b38',
        fg: '#e6edf3',
        muted: '#8b97a7',
        accent: '#2f81f7',
        'accent-2': '#1f6feb',
        ok: '#3fb950',
        warn: '#d29922',
        danger: '#f85149',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
