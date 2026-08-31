import { access, rename, rm } from 'node:fs/promises'

const workerOutput = new URL('../dist/dostigator/', import.meta.url)
const sitesOutput = new URL('../dist/server/', import.meta.url)

await access(new URL('index.js', workerOutput))
await rm(sitesOutput, { recursive: true, force: true })
await rename(workerOutput, sitesOutput)
await rm(new URL('.dev.vars', sitesOutput), { force: true })
