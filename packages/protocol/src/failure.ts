// One wording for both agents when a turn stops on an error: a short label for the timeline, the inbox and the push
// title, and a next step for the push body when the agent's own error text isn't shown (summary privacy).

import type { FailureKind } from './wire.ts'

export const FAILURE_WORDS: Record<FailureKind, { label: string; hint: string }> = {
  usage_limit: { label: 'Usage limit reached', hint: 'It can carry on once the limit resets.' },
  overloaded: { label: 'Servers busy', hint: 'The servers were overloaded. Try again in a minute.' },
  auth: { label: 'Signed out', hint: 'Log in again at the computer.' },
  billing: { label: 'Billing problem', hint: 'Check the account’s billing.' },
  context_full: { label: 'Context full', hint: 'Compact the conversation or start a new session.' },
  output_limit: { label: 'Reply cut off', hint: 'It hit the output limit mid-reply. Ask it to continue.' },
  error: { label: 'Stopped on an error', hint: 'Open the session to see where it stopped.' },
}

export function failureLabel(kind: string | undefined): string {
  return (kind && FAILURE_WORDS[kind as FailureKind]?.label) || FAILURE_WORDS.error.label
}
