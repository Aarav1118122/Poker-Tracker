/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "slate": {
                "100": "#f1f2f6",
                "200": "#dfe1ea",
                "300": "#c3c6d4",
                "400": "#9a9db0",
                "500": "#767a8f",
                "600": "#4d5066",
                "700": "#343646",
                "800": "#242633",
                "900": "#1a1b26",
                "950": "#12131b"
        },
        "indigo": {
                "300": "#ffe58f",
                "400": "#ffd24a",
                "500": "#ffdd6b",
                "600": "#ffc93c",
                "700": "#e6b020",
                "800": "#8a6a00",
                "900": "#4a3a00"
        }
},
    },
  },
  plugins: [],
}
