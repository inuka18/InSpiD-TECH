import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-bg))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          ring: "hsl(var(--sidebar-ring))",
        },
        status: {
          "confirmed-bg": "hsl(var(--status-confirmed-bg))",
          "confirmed-fg": "hsl(var(--status-confirmed-fg))",
          "atrisk-bg": "hsl(var(--status-atrisk-bg))",
          "atrisk-fg": "hsl(var(--status-atrisk-fg))",
          "modified-bg": "hsl(var(--status-modified-bg))",
          "modified-fg": "hsl(var(--status-modified-fg))",
          "dropped-bg": "hsl(var(--status-dropped-bg))",
          "dropped-fg": "hsl(var(--status-dropped-fg))",
          "ripple-bg": "hsl(var(--status-ripple-bg))",
          "ripple-fg": "hsl(var(--status-ripple-fg))",
        },
        class: {
          "constraint-bg": "hsl(var(--class-constraint-bg))",
          "constraint-fg": "hsl(var(--class-constraint-fg))",
          "expectation-bg": "hsl(var(--class-expectation-bg))",
          "expectation-fg": "hsl(var(--class-expectation-fg))",
          "completion-bg": "hsl(var(--class-completion-bg))",
          "completion-fg": "hsl(var(--class-completion-fg))",
          "conflict-bg": "hsl(var(--class-conflict-bg))",
          "conflict-fg": "hsl(var(--class-conflict-fg))",
          "none-bg": "hsl(var(--class-none-bg))",
          "none-fg": "hsl(var(--class-none-fg))",
        },
        series: {
          1: "hsl(var(--series-1))",
          2: "hsl(var(--series-2))",
          3: "hsl(var(--series-3))",
          4: "hsl(var(--series-4))",
          5: "hsl(var(--series-5))",
          6: "hsl(var(--series-6))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 2px 8px -2px rgb(0 0 0 / 0.06)",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        "slide-up": {
          from: { opacity: 0, transform: "translateY(6px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.25s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
