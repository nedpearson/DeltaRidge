import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Delta Ridge Field',
        short_name: 'Delta Ridge',
        description: 'Field intelligence and roof inspection for Delta Ridge Roofing',
        theme_color: '#06b6d4',
        background_color: '#1e293b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // SVG icons keep the whole app text-only and scale perfectly at every
        // launcher size. Chrome accepts `sizes: 'any'` SVG for installability.
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Without navigateFallback a reload with no signal hits the browser's
        // "No internet" page: workbox only has the precached ASSETS, nothing
        // telling it to answer a navigation with the app shell. Verified by
        // going offline and reloading - the whole premise of the app fails
        // without this line.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/assets\//, /^\/api\//],
        // Take control on first activation so the very first visit is already
        // offline-capable, rather than only from the second load onward.
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Field reality: Supabase-backed imagery/data may be unavailable in dead zones;
        // the app shell and locally recorded work remain available offline.
        runtimeCaching: [
          // Google Fonts: the stylesheet changes rarely, the font files never.
          // Without these two entries a reload with no signal renders the whole
          // app in system fonts - verified offline before adding them.
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // tests/live/ calls the real parish, NWS and NCEI services. Useful to run
    // by hand when an upstream feed changes shape; never in a normal test run,
    // where a third party being slow would look like our bug.
    //
    //   Windows:  set LIVE=1 && npx vitest run tests/live
    //   bash:     LIVE=1 npx vitest run tests/live
    //
    // An env switch rather than `--exclude ''`, which the documented form used
    // to rely on: vitest now APPENDS --exclude to this list instead of
    // replacing it, and an empty pattern crashes the glob walker outright.
    exclude: [
      ...(process.env['LIVE'] === '1' ? [] : ['tests/live/**']),
      'node_modules/**',
      'dist/**',
    ],
  },
})
