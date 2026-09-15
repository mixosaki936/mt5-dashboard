/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        page: "#0d0d0d",
        surface: "#1a1a19",
        surface2: "#212120",
        hair: "#2c2c2a",
        line: "#383835",
        ink: "#ffffff",
        ink2: "#c3c2b7",
        muted: "#898781",
        s1: "#3987e5",
        s2: "#d95926",
        s3: "#199e70",
        s4: "#c98500",
        s5: "#d55181",
        s6: "#008300",
        s7: "#9085e9",
        s8: "#e66767",
        good: "#0ca30c",
        warn: "#fab219",
        serious: "#ec835a",
        critical: "#d03b3b",
      },
      fontFamily: {
        sans: [
          "var(--font-ui)",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
