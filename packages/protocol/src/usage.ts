// Usage-limit windows in words, shared by the daemon's push and the app, so both say the same thing.

import type { UsageWindow } from './wire.ts'

/** Which window this is, stable across reports: one agent never reports two windows with the same key. */
export function windowKey(w: UsageWindow): string {
  if (w.kind !== 'other') return w.kind
  return w.name ? `n:${w.name}` : `m:${w.minutes ?? 0}`
}

/** "5-hour", "Weekly", "2-day", "Spend": the window's name, capitalised, to sit before "limit" or beside a meter. */
export function windowLabel(w: UsageWindow): string {
  if (w.kind === 'five_hour') return '5-hour'
  if (w.kind === 'seven_day') return 'Weekly'
  const m = w.minutes ?? 0
  if (m >= 1440 && m % 1440 === 0) return `${m / 1440}-day`
  if (m >= 60 && m % 60 === 0) return `${m / 60}-hour`
  if (m > 0) return `${m}-minute`
  const words = (w.name ?? '')
    .replace(/_?limit$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Other'
}

/** "3d 4h", "2h 15m", "12m": how long until something (a limit resetting), to the minute. */
export function until(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`
}
