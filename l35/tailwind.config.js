/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        'edge-bg': '#0A0E17',
        'edge-card': '#1A1F2E',
        'edge-hover': '#2A3040',
        'edge-green': '#00E5A0',
        'edge-red': '#FF3D71',
        'edge-text': '#E2E8F0',
        'edge-muted': '#64748B',
        'edge-border': '#2A3040',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-red': 'pulse-red 2s ease-in-out infinite',
        'glow-green': 'glow-green 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-red': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'glow-green': {
          '0%, 100%': { boxShadow: '0 0 5px rgba(0, 229, 160, 0.3)' },
          '50%': { boxShadow: '0 0 15px rgba(0, 229, 160, 0.6), 0 0 30px rgba(0, 229, 160, 0.2)' },
        },
      },
    },
  },
  plugins: [],
};
