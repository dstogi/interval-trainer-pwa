import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = '/interval-trainer-pwa/'

export default defineConfig({
  base,
  plugins: [
    react(),
VitePWA({
  registerType: 'autoUpdate',
  includeAssets: [
    'apple-touch-icon.png',
    'pwa-192.png',
    'pwa-512.png',
    'favicon-32.png',
    'favicon-16.png',
  ],
  manifest: {
    name: 'Interval Trainer',
    short_name: 'Interval',
    start_url: base,
    scope: base,
    display: 'standalone',
    background_color: '#6C63FF',
    theme_color: '#6C63FF',
    icons: [
      { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  },

  // 👇 wichtig für offline + “alte caches weg”
  workbox: {
    navigateFallback: 'index.html',
    cleanupOutdatedCaches: true,
    skipWaiting: true,
    clientsClaim: true,
    globPatterns: ['**/*.{js,css,html,ico,png,svg,json,txt,woff2}'],
  },
}),
  ],
})
