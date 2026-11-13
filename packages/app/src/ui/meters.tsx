// A computer's usage limits: one thin meter per rate-limit window, per agent, with when it resets.

import type { UsageInfo } from '@agentwatch/protocol'
import { until, windowKey, windowLabel } from '@agentwatch/protocol/lite'
import { agentLabel, limitLevel, liveWindows } from '../lib/model.ts'

export function Meters({ usage, now }: { usage: UsageInfo | undefined; now: number }) {
  const agents = (['claude', 'codex'] as const)
    .map((agent) => ({ agent, windows: liveWindows(usage?.[agent], now) }))
    .filter((a) => a.windows.length > 0)
  if (!agents.length) return null
  return (
    <div class="meters">
      {agents.map(({ agent, windows }) => (
        <section class="meter-agent" key={agent} aria-label={`${agentLabel(agent)} usage limits`}>
          <h3>{agentLabel(agent)}</h3>
          {windows.map((w) => {
            const pct = Math.round(Math.min(100, Math.max(0, w.percent)))
            return (
              <div class="meter" data-level={limitLevel(pct)} key={windowKey(w)}>
                <span class="meter-name">{windowLabel(w)}</span>
                <span class="meter-pct num">{pct}%</span>
                {w.resetsAt !== null && <span class="meter-reset">Resets in {until(w.resetsAt - now)}</span>}
                {/* The words carry the figure; the bar only draws it. */}
                <span class="meter-bar" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
