/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'uh-purple': '#6d4df5',
        'uh-cyan': '#0ea5e9',
        'uh-dark': '#101828',
        'uh-dark-secondary': '#f3f5fb',
        'uh-dark-tertiary': '#e4e9f4',
        'uh-success': '#10b981',
        'uh-warning': '#f59e0b',
        'uh-error': '#ef4444',
      },
      boxShadow: {
        'elevation-1': '0 1px 3px 1px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.12)',
        'elevation-2': '0 2px 6px 2px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.12)',
        'elevation-3': '0 4px 8px 3px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.12)',
      },
      transitionTimingFunction: {
        'md3': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: {
        'md3': '300ms',
      },
    },
  },
  plugins: [],
}
