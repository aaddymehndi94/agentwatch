// Tiny IndexedDB key-value store shared by the page and the service worker (localStorage is not visible to a SW).
// Holds the device credentials, the vault key and the last state, so the app opens instantly and works offline.

const DB = 'agentwatch'
const STORE = 'kv'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Some browsers (private modes, locked-down profiles) never answer IndexedDB; fail instead of hanging the app. */
function withTimeout<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('storage timed out')), ms))])
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return withTimeout(txInner(mode, fn))
}

async function txInner<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => {
      db.close()
      resolve(req.result)
    }
    t.onerror = () => {
      db.close()
      reject(t.error)
    }
  })
}

export const kv = {
  get: <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key)).then(() => undefined),
  del: (key: string) => tx('readwrite', (s) => s.delete(key)).then(() => undefined),
  clear: () => tx('readwrite', (s) => s.clear()).then(() => undefined),
}

/** What a paired device keeps. The vault key never leaves this device except inside sealed blobs. */
export interface Credentials {
  deviceId: string
  token: string
  vaultKey: string
  name: string
  pairedAt: number
}

export const loadCredentials = () => kv.get<Credentials>('credentials')
export const saveCredentials = (c: Credentials) => kv.set('credentials', c)
