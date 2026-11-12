import { describe, expect, it } from 'vitest'
import { parseMute } from '../src/commands/mute.ts'

describe('parseMute', () => {
  // 2026-11-12 22:30 local time.
  const now = new Date(2026, 10, 12, 22, 30).getTime()

  it('reads durations in minutes and hours, defaulting to an hour', () => {
    expect(parseMute([], now)).toBe(now + 3600_000)
    expect(parseMute(['30m'], now)).toBe(now + 30 * 60_000)
    expect(parseMute(['8h'], now)).toBe(now + 8 * 3600_000)
    expect(parseMute(['1.5', 'hours'], now)).toBe(now + 1.5 * 3600_000)
  })

  it('reads a clock time as the next time it comes round', () => {
    expect(parseMute(['until', '23:00'], now)).toBe(new Date(2026, 10, 12, 23, 0).getTime())
    expect(parseMute(['08:00'], now)).toBe(new Date(2026, 10, 13, 8, 0).getTime())
  })

  it('turns muting off', () => {
    expect(parseMute(['off'], now)).toBeNull()
  })

  it('rejects what it does not understand instead of guessing', () => {
    expect(() => parseMute(['tomorrow'], now)).toThrow(/Try:/)
    expect(() => parseMute(['25:00'], now)).toThrow(/Not a time/)
    expect(() => parseMute(['30d'], now)).toThrow()
    expect(() => parseMute(['9999h'], now)).toThrow(/a week/)
  })
})
