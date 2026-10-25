// Include background queues and Auth writes, not only the currently visible form.
let pendingWrites = 0
const listeners = new Set<() => void>()
export const getPendingWrites = () => pendingWrites
export const subscribePendingWrites = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const changed = () => { listeners.forEach(listener => listener()) }

export const trackedSupabaseFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const writing = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  if (writing) { pendingWrites += 1; changed() }
  try {
    // Resolve fetch when invoked so native behaviour, mocks and request arguments stay intact.
    return await globalThis.fetch(input, init)
  } finally {
    if (writing) { pendingWrites -= 1; changed() }
  }
}
