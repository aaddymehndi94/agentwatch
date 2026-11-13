import { describe, expect, it } from 'vitest'
import { clip, isYourPrompt, readPrompt } from '../src/index.ts'

const TASK = `<task-notification>
<task-id>a41f99c5612563acf</task-id>
<tool-use-id>toolu_013vbZEKoWt8MengpQZymaCM</tool-use-id>
<output-file>/tmp/tasks/a41f99c5612563acf.output</output-file>
<status>completed</status>
<summary>Agent "Finish review" finished</summary>
<result>Long report…</result>
</task-notification>`

describe('readPrompt', () => {
  it('keeps what you typed', () => {
    expect(readPrompt('  Run the tests\n')).toEqual({ from: 'you', text: 'Run the tests' })
    expect(readPrompt('Is <div> or <my-button> better here?')).toEqual({
      from: 'you',
      text: 'Is <div> or <my-button> better here?',
    })
  })

  it('turns a background-task notice into a quiet line with its summary', () => {
    expect(readPrompt(TASK)).toEqual({
      from: 'agent',
      kind: 'task-done',
      label: 'Background task finished',
      detail: 'Agent "Finish review" finished',
    })
    expect(readPrompt(TASK.replace('completed', 'failed'))).toMatchObject({
      kind: 'task-failed',
      label: 'Background task failed',
    })
    expect(readPrompt(TASK.replace('completed', 'killed'))).toMatchObject({
      kind: 'task-stopped',
      label: 'Background task stopped',
    })
  })

  it('recognises a notice even after it was flattened and cut, as old session titles were', () => {
    expect(isYourPrompt(clip(TASK, 80))).toBe(false)
  })

  it('drops system reminders, and anything that is only a reminder', () => {
    expect(readPrompt('<system-reminder>Plan mode is on.</system-reminder>\nFix the bug')).toEqual({
      from: 'you',
      text: 'Fix the bug',
    })
    expect(readPrompt('<system-reminder>x</system-reminder>')).toBeNull()
  })

  it('shows slash commands and shell commands as you typed them', () => {
    expect(
      readPrompt(
        '<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>42</command-args>',
      ),
    ).toEqual({ from: 'you', text: '/review 42' })
    expect(readPrompt('<bash-input>git status</bash-input>')).toEqual({ from: 'you', text: '! git status' })
  })

  it('hides local command output', () => {
    expect(readPrompt('<local-command-stdout>Done</local-command-stdout>')).toBeNull()
    expect(readPrompt('<bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>')).toBeNull()
  })

  it('marks messages from other agents and other harness envelopes as automatic', () => {
    expect(readPrompt('<cross-session-message from="worker">hi</cross-session-message>')).toEqual({
      from: 'agent',
      kind: 'agent',
      label: 'Message from another agent',
    })
    expect(readPrompt('<user-prompt-submit-hook>extra</user-prompt-submit-hook>')).toEqual({
      from: 'agent',
      kind: 'auto',
      label: 'Automatic message',
    })
  })
})
