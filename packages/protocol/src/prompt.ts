// Agents put their own messages into the user's turn. Claude Code delivers background-task results, slash-command
// output, `!` shell output and messages from other sessions as "prompts" wrapped in tags, and fires
// UserPromptSubmit for them. You never typed those, so they mustn't title a session or show up as your message.
// The daemon uses this to pick titles, and the phone uses it to draw the timeline (including events stored before
// the daemon knew better).

export type Prompt =
  /** Something you typed (or a slash command / `!` command you ran). */
  | { from: 'you'; text: string }
  /** Something the agent's harness sent on its own, shown as a quiet line, not as your message. */
  | { from: 'agent'; kind: AgentNotice; label: string; detail?: string }

export type AgentNotice = 'task-done' | 'task-failed' | 'task-stopped' | 'agent' | 'auto'

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g
/** Output of a local command: already on your screen, not a prompt at all. */
const LOCAL_OUTPUT = /^<(local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr)>/
const FROM_SESSION = /^<(cross-session-message|agent-message|teammate-message)\b/
/** A whole message in one custom tag (`<user-prompt-submit-hook>…</user-prompt-submit-hook>`): harness-made. */
const ENVELOPE = /^<([a-z][a-z0-9]*[-_][a-z0-9_-]*)(\s[^>]*)?>[\s\S]*<\/\1>$/

function tag(text: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)
  const v = m?.[1]?.trim()
  return v ? v : undefined
}

/** Who a prompt is really from, and what to show for it. `null` means show nothing. */
export function readPrompt(raw: string): Prompt | null {
  const text = raw.replace(REMINDER, '').trim()
  if (!text) return null
  if (text.startsWith('<task-notification>')) {
    const status = tag(text, 'status') ?? ''
    const [kind, label]: [AgentNotice, string] = /fail|error/i.test(status)
      ? ['task-failed', 'Background task failed']
      : /kill|stop|cancel/i.test(status)
        ? ['task-stopped', 'Background task stopped']
        : ['task-done', 'Background task finished']
    const detail = tag(text, 'summary')
    return detail ? { from: 'agent', kind, label, detail } : { from: 'agent', kind, label }
  }
  if (FROM_SESSION.test(text)) return { from: 'agent', kind: 'agent', label: 'Message from another agent' }
  if (LOCAL_OUTPUT.test(text)) return null
  const command = tag(text, 'command-name')
  if (command) {
    const args = tag(text, 'command-args')
    return { from: 'you', text: args ? `${command} ${args}` : command }
  }
  const shell = tag(text, 'bash-input')
  if (shell) return { from: 'you', text: `! ${shell}` }
  if (ENVELOPE.test(text)) return { from: 'agent', kind: 'auto', label: 'Automatic message' }
  return { from: 'you', text }
}

/** True when this text was typed by you, so it can title a session. */
export function isYourPrompt(raw: string | undefined): raw is string {
  return !!raw && readPrompt(raw)?.from === 'you'
}
