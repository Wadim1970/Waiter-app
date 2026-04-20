import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/Waiter_logo-180.png',
        'icons/Waiter_logo-192.png',
        'icons/Waiter_logo-512.png',
        'icons/Waiter_logo-maskable-180.png',
        'icons/Waiter_logo-maskable-192.png',
        'icons/Waiter_logo-maskable-512.png',
      ],
      // Keep using the static public/manifest.json file as the single manifest source.
      manifest: false,
    }),
  ],
  server: {
    port: 5173,
    host: true
  }
})
