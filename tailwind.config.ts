import type { Config } from "tailwindcss";

// ConnectOS brand theme, matching connectos-bi-chat so the candidate portal and
// COSAI look like the same family.
const config: Config = {
  // Dark mode follows the data-theme attribute set on <html> (see layout.tsx).
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          // Every colour is a CSS variable (defined for light and dark in
          // globals.css) so a theme switch is one attribute on <html>. The
          // channel-triplet form keeps opacity modifiers like bg-brand-gold/50 working.
          bg: "rgb(var(--c-bg) / <alpha-value>)",
          surface: "rgb(var(--c-surface) / <alpha-value>)",
          sunken: "rgb(var(--c-sunken) / <alpha-value>)",
          line: "rgb(var(--c-line) / <alpha-value>)",
          "line-strong": "rgb(var(--c-line-strong) / <alpha-value>)",
          gold: "rgb(var(--c-gold) / <alpha-value>)",
          "gold-dark": "rgb(var(--c-gold-dark) / <alpha-value>)",
          "gold-tint": "rgb(var(--c-gold-tint) / <alpha-value>)",
          teal: "rgb(var(--c-teal) / <alpha-value>)",
          "teal-dark": "rgb(var(--c-teal-dark) / <alpha-value>)",
          "teal-tint": "rgb(var(--c-teal-tint) / <alpha-value>)",
          ink: "rgb(var(--c-ink) / <alpha-value>)",
          text: "rgb(var(--c-text) / <alpha-value>)",
          muted: "rgb(var(--c-muted) / <alpha-value>)",
          faint: "rgb(var(--c-faint) / <alpha-value>)",
          "on-gold": "rgb(var(--c-on-gold) / <alpha-value>)",
          "on-teal": "rgb(var(--c-on-teal) / <alpha-value>)",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(60, 50, 30, 0.06), 0 1px 1px rgba(60, 50, 30, 0.04)",
        focus: "0 0 0 3px rgba(189, 156, 103, 0.22)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.3s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
