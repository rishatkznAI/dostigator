import { cloudflare } from '@cloudflare/vite-plugin'
import { sites } from '@openai/sites-vite-plugin'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

const isGitHubPages = process.env.GITHUB_PAGES === 'true'

// https://vite.dev/config/
export default defineConfig({
  base: isGitHubPages ? '/dostigator/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Достигатор',
        short_name: 'Достигатор',
        description: 'Личные цели, проекты и дисциплина',
        theme_color: '#0b0c10',
        background_color: '#0b0c10',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/\/auth\/v1\//, /\/rest\/v1\//],
        runtimeCaching: [],
      },
    }),
    ...(process.env.VITEST || isGitHubPages ? [] : [sites(), cloudflare()]),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
