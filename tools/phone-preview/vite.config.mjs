import preview from '../../tests/local-browser/vite.config.mjs'
import { fileURLToPath } from 'node:url'

export default {
  ...preview,
  plugins: [...preview.plugins, {
    name: 'phone-preview-http-bootstrap',
    transformIndexHtml: {
      order: 'post',
      handler: () => [{ tag: 'script', attrs: { src: '/mobile-preview-bootstrap.js' }, injectTo: 'head-prepend' }],
    },
  }],
  build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true, sourcemap: false },
}
