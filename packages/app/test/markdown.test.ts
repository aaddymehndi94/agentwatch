import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, plainText } from '../src/lib/markdown.ts'

describe('markdown blocks', () => {
  it('parses what an agent typically writes', () => {
    const md = [
      '## Summary',
      '',
      'Moved the webhooks onto the **queue**.',
      'Retries are idempotent now.',
      '',
      '- Added `QueueConsumer`',
      '- Tests:',
      '  - `retry.test.ts`',
      '  - `idempotency.test.ts`',
      '',
      '1. Run the migration',
      '2. Deploy',
      '',
      '```ts',
      'const x = 1',
      '',
      'export { x }',
      '```',
      '',
      '> Note: staging only.',
      '',
      '---',
    ].join('\n')
    const b = parseMarkdown(md)
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'list', 'list', 'code', 'quote', 'hr'])
    expect(b[1]).toEqual({
      t: 'p',
      c: [
        { t: 'text', v: 'Moved the webhooks onto the ' },
        { t: 'strong', c: [{ t: 'text', v: 'queue' }] },
        { t: 'text', v: '.' },
        { t: 'br' },
        { t: 'text', v: 'Retries are idempotent now.' },
      ],
    })
    const bullets = b[2] as Extract<(typeof b)[number], { t: 'list' }>
    expect(bullets.items).toHaveLength(2)
    expect(bullets.items[1]!.c.map((x) => x.t)).toEqual(['p', 'list'])
    const numbered = b[3] as Extract<(typeof b)[number], { t: 'list' }>
    expect(numbered).toMatchObject({ ordered: true, start: 1 })
    expect(numbered.items).toHaveLength(2)
    expect(b[4]).toEqual({ t: 'code', lang: 'ts', v: 'const x = 1\n\nexport { x }' })
  })

  it('keeps numbered items with blank lines between them in one list', () => {
    const b = parseMarkdown('3. one\n\n4. two\n\n5. three')
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ t: 'list', ordered: true, start: 3 })
  })

  it('reads a GitHub table, with alignment and pipes inside code', () => {
    const b = parseMarkdown('| File | Lines |\n|:-----|------:|\n| `a|b.ts` | 12 |\n| c.ts | 3 |')
    expect(b[0]).toMatchObject({ t: 'table', align: ['left', 'right'] })
    const t = b[0] as Extract<(typeof b)[number], { t: 'table' }>
    expect(t.rows).toHaveLength(2)
    expect(t.rows[0]![0]).toEqual([{ t: 'code', v: 'a|b.ts' }])
  })

  it('treats a fence cut off by the length limit as code to the end', () => {
    expect(parseMarkdown('Here:\n```sh\nnpm test…')).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'Here:' }] },
      { t: 'code', lang: 'sh', v: 'npm test…' },
    ])
  })

  it('reads task lists', () => {
    const b = parseMarkdown('- [x] done\n- [ ] todo')
    expect(b[0]).toMatchObject({ t: 'list', items: [{ task: true }, { task: false }] })
  })
})

describe('markdown inline', () => {
  it('leaves snake_case, lone asterisks and arithmetic alone', () => {
    expect(parseInline('use snake_case_name and 2 * 3 * 4')).toEqual([
      { t: 'text', v: 'use snake_case_name and 2 * 3 * 4' },
    ])
  })

  it('parses emphasis, strikethrough and code', () => {
    expect(parseInline('*a* _b_ ~~c~~ `d`')).toEqual([
      { t: 'em', c: [{ t: 'text', v: 'a' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'del', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd' },
    ])
  })

  it('turns links into labelled text, never anything clickable', () => {
    expect(parseInline('see [the docs](https://example.com/a_(b)) or https://x.dev/y.')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', c: [{ t: 'text', v: 'the docs' }], url: 'https://example.com/a_(b)' },
      { t: 'text', v: ' or ' },
      { t: 'link', c: [{ t: 'text', v: 'https://x.dev/y' }], url: 'https://x.dev/y' },
      { t: 'text', v: '.' },
    ])
  })

  it('treats HTML as text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ t: 'text', v: '<img src=x onerror=alert(1)>' }])
  })

  it('honours backslash escapes', () => {
    expect(parseInline('\\*not em\\*')).toEqual([{ t: 'text', v: '*not em*' }])
  })
})

describe('plainText', () => {
  it('flattens Markdown for previews', () => {
    expect(plainText('## Done\n\n- **one**\n- `two`\n\n```\nnpm test\n```')).toBe('Done one · two npm test')
  })
})
