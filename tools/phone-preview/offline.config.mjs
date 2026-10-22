import preview from './vite.config.mjs'
import {VitePWA} from 'vite-plugin-pwa'
import {fileURLToPath} from 'node:url'
export default {...preview,plugins:[...preview.plugins,VitePWA({registerType:'autoUpdate',injectRegister:'script',manifest:false,workbox:{globPatterns:['**/*.{js,css,html,svg,jpg,png}'],maximumFileSizeToCacheInBytes:20000000}})],build:{...preview.build,outDir:fileURLToPath(new URL('../../.cache/offline-preview',import.meta.url))}}
