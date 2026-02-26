/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Ultrahuman brand colors (accessible on light backgrounds)
        'uh-purple': '#6d4df5',
        'uh-cyan': '#0ea5e9',
        'uh-dark': '#101828',
        'uh-dark-secondary': '#f3f5fb',
        'uh-dark-tertiary': '#e4e9f4',
        'uh-success': '#10b981',
        'uh-warning': '#f59e0b',
        'uh-error': '#ef4444',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #7c3aed, #00d4ff)',
        'gradient-dark': 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%)',
      },
    },
  },
  plugins: [],
}
