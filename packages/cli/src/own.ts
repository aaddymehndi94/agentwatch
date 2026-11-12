// Can anyone but this user (or root) change a file or folder? Shared by the installer, which picks the Node every hook
// runs, and the hook client, which must only talk to this user's own daemon. Node builtins only: the hook loads it.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Ids {
  uid: number
  gid: number
}

export const me = (): Ids => ({ uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 })

/**
 * A group no other account belongs to: Linux's "user private group", where a group-writable folder (umask 002, as nvm
 * leaves them) is as safe as an owner-only one. A shared primary group such as `users` or macOS's `staff` is not.
 */
export function privateGroup(gid: number, ids: Ids = me()): boolean {
  if (gid === 0) return true
  if (gid !== ids.gid) return false
  try {
    const name = os.userInfo().username
    const rows = (file: string) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => l.split(':'))
    const group = rows('/etc/group').find((f) => Number(f[2]) === gid)
    if (group?.[3]?.split(',').some((m) => m && m !== name)) return false
    return !rows('/etc/passwd').some((f) => f.length > 3 && Number(f[3]) === gid && Number(f[2]) !== ids.uid)
  } catch {
    return false
  }
}

/** Owned by someone else, or writable by others. A sticky folder (like /tmp) only lets owners replace entries. */
export function changeableByOthers(st: fs.Stats, ids: Ids = me()): boolean {
  if (st.uid !== 0 && st.uid !== ids.uid) return true
  if (st.isDirectory() && st.mode & 0o1000) return false
  if (st.mode & 0o002) return true
  return (st.mode & 0o020) !== 0 && !privateGroup(st.gid, ids)
}

/**
 * Safe to exec on every hook: neither the file, nor any folder on the way to it, nor any link it goes through, can be
 * changed by anyone but this user or root.
 */
export function trustedBinary(file: string, ids: Ids = me()): boolean {
  if (!path.isAbsolute(file)) return false
  try {
    const seen = new Set<string>()
    const ok = (p: string) => {
      if (seen.has(p)) return true
      seen.add(p)
      return !changeableByOthers(fs.statSync(p), ids)
    }
    const folders = (p: string) => {
      for (let d = path.dirname(p); ; d = path.dirname(d)) {
        if (!ok(d)) return false
        if (path.dirname(d) === d) return true
      }
    }
    let hop = file
    for (let i = 0; i < 40; i++) {
      if (!folders(hop)) return false
      if (!fs.lstatSync(hop).isSymbolicLink()) break
      hop = path.resolve(path.dirname(hop), fs.readlinkSync(hop))
    }
    const real = fs.realpathSync(file)
    return folders(real) && ok(real)
  } catch {
    return false
  }
}

/** For a folder that may not exist yet: whatever it is, or will be created in, belongs to this user alone. */
export function foreignFolder(dir: string, ids: Ids = me()): boolean {
  for (let d = dir; ; d = path.dirname(d)) {
    try {
      return changeableByOthers(fs.statSync(d), ids)
    } catch {
      if (path.dirname(d) === d) return true
    }
  }
}
