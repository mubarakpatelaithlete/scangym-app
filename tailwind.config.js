/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './frontend/public/**/*.{html,js}',
  ],
  theme: {
    extend: {
      colors: {
        brand: '#FF6D00',
        accent: '#00e676',
        dark: '#0f172a',
        card: '#1e293b',
      },
      fontFamily: {
        brand: ['Sora', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
