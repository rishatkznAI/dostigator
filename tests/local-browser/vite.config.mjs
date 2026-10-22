import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const here = fileURLToPath(new URL('.', import.meta.url))
const repo = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({
  root: here, cacheDir: `${repo}.cache/local-preview`, plugins: [react()],
  resolve: { alias: [
    { find: /^.*(context\/AuthContext|\.\/AuthContext)$/, replacement: `${here}auth.ts` },
    { find: /^.*(lib\/supabase|\.\/supabase)$/, replacement: `${here}supabase.ts` },
    { find: /^.*(?:lib\/|\.\/)trainingRepository$/, replacement: `${here}repository.ts` },
  ] },
  server: { host: '127.0.0.1', port: 4192, strictPort: true, fs: { allow: [repo] } },
})
