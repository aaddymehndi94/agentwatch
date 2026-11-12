/** "4m 12s", "2h 05m": a wait or a duration, compact and tabular. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** "now", "3m", "2h", "4d": how long ago, for quiet rows. */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** Clock time of a ticket, like a kitchen printer stamps it. */
export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * How "hot" a wait is, 0..1 on a log scale: 0 at 0 s, ~0.5 at 5 min, 1 at 2 h.
 * Drives the ticket's heat band and the length of its timer bar.
 */
export function heat(ms: number): number {
  const min = ms / 60_000
  return Math.max(0, Math.min(1, Math.log1p(min) / Math.log1p(120)))
}
