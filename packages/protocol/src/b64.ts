// base64url without padding, for Uint8Array. Works in Node ≥ 22, Workers and browsers (atob/btoa are global).

export function toB64u(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('invalid base64url')
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const enc = new TextEncoder()
const dec = new TextDecoder()
export const utf8 = (s: string): Uint8Array => enc.encode(s)
export const fromUtf8 = (b: Uint8Array): string => dec.decode(b)
