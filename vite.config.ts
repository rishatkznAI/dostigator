import { cloudflare } from '@cloudflare/vite-plugin'
import { sites } from '@openai/sites-vite-plugin'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const isGitHubPages = process.env.GITHUB_PAGES === 'true'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (isGitHubPages && command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter((name) => !env[name]?.trim())
    if (missing.length) throw new Error(`GitHub Pages build requires ${missing.join(', ')}. Configure repository secrets before publishing.`)
  }
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
  const buildInfo = {
    version,
    commit: /^[a-f0-9]{7,40}$/i.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA!.toLowerCase() : 'local',
    builtAt: new Date().toISOString(),
  }
  return {
    cacheDir: '.cache/vite',
    base: isGitHubPages ? '/dostigator/' : '/',
    define: { __DOSTIGATOR_BUILD__: JSON.stringify(buildInfo) },
    plugins: [
      react(),
      {
        name: 'dostigator-build-info',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(buildInfo, null, 2) + '\n' })
        },
      },
      VitePWA({
        registerType: 'prompt',
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
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  }
})
