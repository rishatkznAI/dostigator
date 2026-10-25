import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export async function prepareFreshEntry(directory) {
  const base = pathToFileURL(resolve(directory) + '/')
  const html = await readFile(new URL('index.html', base), 'utf8')
  // Legacy workers already exclude /auth/v1/ from their navigation fallback.
  // Emit AFTER Workbox precaching, so this document is never the cached shell.
  await mkdir(new URL('auth/v1/', base), { recursive: true })
  await writeFile(new URL('auth/v1/open.html', base), html)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.env.GITHUB_PAGES === 'true') {
  await prepareFreshEntry(fileURLToPath(new URL('../dist/', import.meta.url)))
}
