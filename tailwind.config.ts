import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#4F46E5",   // indigo-600
          light: "#EEF2FF",     // indigo-50
          dark: "#3730A3",      // indigo-800
          muted: "#818CF8",     // indigo-400
        },
        accent: {
          DEFAULT: "#F59E0B",   // amber-500
          light: "#FEF3C7",
          dark: "#92400E",
        },
        sidebar: "#1E1B4B",     // deep indigo
        ink: "#0F172A",
        body: "#334155",
        muted: "#64748B",
        subtle: "#94A3B8",
        surface: "#F8FAFC",
        card: "#FFFFFF",
        border: "#E2E8F0",
        success: "#10B981",
        warning: "#F59E0B",
        danger: "#EF4444",
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.05)",
        panel: "0 20px 60px -10px rgb(0 0 0 / 0.18)",
      },
    },
  },
  plugins: [],
};
export default config;
