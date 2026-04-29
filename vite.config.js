import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Waiter App',
        short_name: 'Waiter',
        description: 'Приложение для официантов',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
     workbox: {
  globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
  runtimeCaching: [
    // НОВОЕ: Кэш для тайлов OpenStreetMap
    {
      urlPattern: /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'osm-tiles-cache',
        expiration: {
          maxEntries: 500,
          maxAgeSeconds: 60 * 60 * 24 * 30 // 30 дней
        },
        cacheableResponse: {
          statuses: [0, 200]
        }
      }
    },
    {
      urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts-cache',
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 60 * 60 * 24 * 365
        },
        cacheableResponse: {
          statuses: [0, 200]
        }
      }
    },
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'supabase-cache',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 60 * 5
        },
        networkTimeoutSeconds: 3
      }
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|webp)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'images-cache',
        expiration: {
          maxEntries: 60,
          maxAgeSeconds: 60 * 60 * 24 * 30
        }
      }
    }
  ]
}
    })
  ],
  base: './',
  build: {
    // УБРАЛИ manualChunks - rolldown-vite его не поддерживает в объектной форме
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // ФУНКЦИОНАЛЬНАЯ форма manualChunks (поддерживается rolldown)
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'react-vendor'
            }
            if (id.includes('leaflet')) {
              return 'map-vendor'
            }
            if (id.includes('supabase')) {
              return 'supabase-vendor'
            }
          }
        }
      }
    }
  }
})
