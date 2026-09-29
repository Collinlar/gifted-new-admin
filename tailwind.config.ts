import type { Config } from "tailwindcss";

// The Gifted navy. Kept in step with gifted-project/src/lib/navy.js, which is
// where this ramp is defined and commented. The admin had been on indigo while
// the product was on navy, which is part of why the blue changed depending on
// where you were standing.
const NAVY = {
  50:  "#F0F4F8",
  100: "#DFE8F1",
  200: "#BCD1E6",
  300: "#87B0D9",
  400: "#4B8CCE",
  500: "#2A6EB2",
  600: "#1D5790",
  700: "#15426F",
  800: "#103254",
  900: "#0B1F33",
  950: "#07131F",
};

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
          DEFAULT: NAVY[600],
          light: NAVY[50],
          dark: NAVY[800],
          muted: NAVY[400],
        },
        navy: NAVY,
        // Tailwind's own blue is a brighter, different hue. Re-pointed so a
        // stray bg-blue-600 cannot reintroduce the old mismatch.
        blue: NAVY,
        accent: {
          DEFAULT: "#F59E0B",   // amber-500
          light: "#FEF3C7",
          dark: "#92400E",
        },
        sidebar: NAVY[900],     // the homepage panel navy
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
