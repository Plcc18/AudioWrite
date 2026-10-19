import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        doubt: {
          bg: "#fef3c7",
          border: "#d97706",
          text: "#92400e",
        },
      },
    },
  },
  plugins: [],
};

export default config;
