import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        // `index.html` is the marketing landing (default served at `/` by static hosts).
        // `app.html` is the CMS shell (served only via the `/cms` rewrite to avoid
        // filesystem-first hosts like Vercel from serving the CMS shell at `/`).
        landing: path.resolve(__dirname, 'index.html'),
        app: path.resolve(__dirname, 'app.html'),
      },
    },
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      // Shared helpers under src/lib; @ maps to src/app, so @/lib/* needs an explicit rule
      {
        find: /^@\/lib\/(.+)$/,
        replacement: path.resolve(__dirname, './src/lib/$1'),
      },
      { find: '@', replacement: path.resolve(__dirname, './src/app') },
    ],
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
