// A session's timeline as the screen draws it: your prompts, the agent's replies, and quiet lines for everything else.

import { readPrompt } from '@agentwatch/protocol/lite'
import type { EventVM, SessionVM } from './model.ts'

export type Item =
  | { k: 'you'; at: number; text: string; phone: boolean; queued?: boolean }
  | { k: 'agent'; at: number; text: string; latest: boolean }
  | { k: 'sys'; at: number; icon: 'ask' | 'ok' | 'end' | 'info' | 'msg'; label: string; text?: string }

/** A reply's prompt enters just before the daemon reports it (same text), or after the turn it queued behind. */
const PROMPT_BEFORE_REPLY_MS = 10_000

/**
 * The prompt each phone reply became: the first prompt of yours with the same text, from just before the reply on.
 * The reply's bubble stands for both, and a queued reply stops being queued once its prompt is in.
 */
function matchReplies(events: EventVM[]): { prompts: Set<EventVM>; delivered: Set<EventVM> } {
  const prompts = new Set<EventVM>()
  const delivered = new Set<EventVM>()
  for (const r of events) {
    if ((r.kind !== 'replied' && r.kind !== 'queued') || !r.text) continue
    const p = events.find(
      (e) =>
        e.kind === 'prompted' &&
        !prompts.has(e) &&
        e.at >= r.at - PROMPT_BEFORE_REPLY_MS &&
        e.text !== undefined &&
        readPrompt(e.text)?.from === 'you' &&
        e.text.trim() === r.text!.trim(),
    )
    if (!p) continue
    prompts.add(p)
    delivered.add(r)
  }
  return { prompts, delivered }
}

/** The timeline, oldest first, plus the latest message if the timeline doesn't already end with it. */
export function thread(events: EventVM[], s: SessionVM): Item[] {
  const items: Item[] = []
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const { prompts, delivered } = matchReplies(sorted)
  const queued: Item[] = []
  for (const e of sorted) {
    switch (e.kind) {
      case 'prompted': {
        if (prompts.has(e)) break
        // Claude Code submits its own notices (background tasks, other agents) as prompts: a quiet line, not you.
        const p = e.text ? readPrompt(e.text) : { from: 'you' as const, text: '' }
        if (!p) break
        items.push(
          p.from === 'agent'
            ? {
                k: 'sys',
                at: e.at,
                icon: p.kind === 'task-done' ? 'ok' : p.kind === 'agent' || p.kind === 'auto' ? 'msg' : 'info',
                label: p.label,
                ...(p.detail ? { text: p.detail } : {}),
              }
            : p.text
              ? { k: 'you', at: e.at, text: p.text, phone: false }
              : { k: 'sys', at: e.at, icon: 'info', label: 'You sent a prompt' },
        )
        break
      }
      case 'replied':
      case 'queued': {
        if (!e.text) {
          items.push({ k: 'sys', at: e.at, icon: 'info', label: 'You replied' })
          break
        }
        const waits = e.kind === 'queued' && !delivered.has(e) && s.state !== 'ended'
        // Still waiting for the turn: it's the next thing to happen, so it goes last, under the agent's latest.
        if (waits) queued.push({ k: 'you', at: e.at, text: e.text, phone: true, queued: true })
        else items.push({ k: 'you', at: e.at, text: e.text, phone: true })
        break
      }
      case 'waiting':
        // The turn ended but its background work is still out: the agent's words, if any, and nothing louder.
        items.push(
          e.text
            ? { k: 'agent', at: e.at, text: e.text, latest: false }
            : { k: 'sys', at: e.at, icon: 'info', label: 'Handed work to the background' },
        )
        break
      case 'done':
        items.push(
          e.text
            ? { k: 'agent', at: e.at, text: e.text, latest: false }
            : { k: 'sys', at: e.at, icon: 'ok', label: 'Finished a turn' },
        )
        break
      case 'needs_you':
        items.push({ k: 'sys', at: e.at, icon: 'ask', label: 'Needed you', text: e.text })
        break
      case 'answered':
        items.push({ k: 'sys', at: e.at, icon: 'ok', label: e.text ?? 'Answered' })
        break
      case 'ended':
        items.push({ k: 'sys', at: e.at, icon: 'end', label: 'Session ended' })
        break
      default:
        items.push({ k: 'sys', at: e.at, icon: 'info', label: e.kind })
    }
  }
  const snippet = s.info?.snippet?.trim()
  if (snippet) {
    const lastAgent = [...items].reverse().find((i) => i.k === 'agent')
    if (!lastAgent || lastAgent.text.trim() !== snippet) {
      items.push({ k: 'agent', at: s.updatedAt, text: snippet, latest: s.state === 'working' })
    }
  }
  return [...items, ...queued]
}
