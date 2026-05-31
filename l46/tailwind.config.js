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
        background: {
          DEFAULT: "#0a0e17",
          dark: "#0d1320",
          card: "rgba(13, 19, 32, 0.8)",
        },
        border: {
          DEFAULT: "#1a2332",
          highlight: "rgba(0, 245, 212, 0.3)",
        },
        accent: {
          DEFAULT: "#00f5d4",
          hover: "#00d4b8",
          dark: "#00b4a0",
          glow: "rgba(0, 245, 212, 0.15)",
        },
        anomaly: {
          DEFAULT: "#f59e0b",
          hover: "#d97706",
          glow: "rgba(245, 158, 11, 0.15)",
        },
        text: {
          primary: "#ffffff",
          secondary: "#9ca3af",
          muted: "#6b7280",
        },
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        "glow-cyan": "0 0 20px rgba(0, 245, 212, 0.15)",
        "glow-cyan-lg": "0 0 40px rgba(0, 245, 212, 0.2)",
        "glow-amber": "0 0 20px rgba(245, 158, 11, 0.15)",
        "inner-dark": "inset 0 2px 4px 0 rgba(0, 0, 0, 0.3)",
        card: "0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)",
      },
      backdropBlur: {
        xs: "2px",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-in": "slideIn 0.3s ease-out",
        "glow": "glow 2s ease-in-out infinite alternate",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideIn: {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        glow: {
          "0%": { boxShadow: "0 0 5px rgba(0, 245, 212, 0.3)" },
          "100%": { boxShadow: "0 0 20px rgba(0, 245, 212, 0.6)" },
        },
      },
    },
  },
  plugins: [],
};
