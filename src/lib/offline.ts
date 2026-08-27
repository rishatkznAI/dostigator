import { supabase } from './supabase'
import type { PendingOperation, TableName } from '../types'

const queueKey = 'dostigator:sync-queue:v1'

export function readQueue(): PendingOperation[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(queueKey) ?? '[]')
    return Array.isArray(parsed) ? parsed as PendingOperation[] : []
  } catch {
    return []
  }
}

function writeQueue(queue: PendingOperation[]) {
  localStorage.setItem(queueKey, JSON.stringify(queue))
  window.dispatchEvent(new Event('dostigator:queue'))
}

export function enqueue(operation: Omit<PendingOperation, 'id' | 'createdAt'>) {
  const queue = readQueue()
  const next: PendingOperation = { ...operation, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  const withoutOlderRow = operation.type === 'upsert' && operation.payload?.id
    ? queue.filter((item) => !(item.type === 'upsert' && item.table === operation.table && item.payload?.id === operation.payload?.id))
    : queue
  writeQueue([...withoutOlderRow, next])
}

export function isNetworkError(reason: unknown) {
  if (!navigator.onLine) return true
  const message = reason instanceof Error ? reason.message : String(reason)
  return /fetch|network|offline|connection/i.test(message)
}

async function executeOperation(operation: PendingOperation) {
  if (operation.type === 'upsert' && operation.payload) {
    const { error } = await supabase.from(operation.table).upsert(operation.payload as never)
    if (error) throw error
    return
  }
  if (operation.type === 'delete' && operation.rowId) {
    const { error } = await supabase.from(operation.table).delete().eq('id', operation.rowId)
    if (error) throw error
  }
}

export async function persistOrQueue(table: TableName, payload: Record<string, unknown>) {
  try {
    if (!navigator.onLine) throw new Error('offline')
    const { error } = await supabase.from(table).upsert(payload as never)
    if (error) throw error
  } catch (reason) {
    if (!isNetworkError(reason)) throw reason
    enqueue({ table, type: 'upsert', payload })
  }
}

export async function deleteOrQueue(table: TableName, rowId: string) {
  try {
    if (!navigator.onLine) throw new Error('offline')
    const { error } = await supabase.from(table).delete().eq('id', rowId)
    if (error) throw error
  } catch (reason) {
    if (!isNetworkError(reason)) throw reason
    enqueue({ table, type: 'delete', rowId })
  }
}

export async function flushQueue() {
  if (!navigator.onLine) return 0
  const queue = readQueue()
  let completed = 0
  for (const operation of queue) {
    try {
      await executeOperation(operation)
      completed += 1
      writeQueue(readQueue().filter((item) => item.id !== operation.id))
    } catch (reason) {
      if (!isNetworkError(reason)) {
        writeQueue(readQueue().filter((item) => item.id !== operation.id))
        continue
      }
      break
    }
  }
  return completed
}
