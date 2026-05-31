/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,vue}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        bg: {
          900: '#0A1628',
          800: '#0F1E36',
          700: '#15274A',
          600: '#1E3560',
        },
        neon: {
          blue: '#00D4FF',
          purple: '#7C3AED',
          green: '#00FFA3',
          red: '#FF4757',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Noto Sans SC', 'sans-serif'],
      },
      boxShadow: {
        'neon-blue': '0 0 15px rgba(0, 212, 255, 0.5)',
        'neon-purple': '0 0 15px rgba(124, 58, 237, 0.5)',
        'neon-green': '0 0 15px rgba(0, 255, 163, 0.5)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(0, 212, 255, 0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(0, 212, 255, 0.8)' },
        }
      }
    },
  },
  plugins: [],
};
