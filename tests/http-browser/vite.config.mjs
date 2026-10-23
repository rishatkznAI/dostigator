import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const repo=fileURLToPath(new URL('../../',import.meta.url))
// The app, repositories and Supabase client are unchanged. Only this test build's endpoint differs.
export default defineConfig({root:repo,cacheDir:repo+'.cache/http-browser',plugins:[react()],
  define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://192.168.1.137:4210'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('isolated-http-test')},
  resolve:{alias:[{find:'virtual:pwa-register',replacement:fileURLToPath(new URL('./sw.ts',import.meta.url))}]},
  server:{host:'127.0.0.1',port:4211,strictPort:true}})
