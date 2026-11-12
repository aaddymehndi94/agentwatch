// Renders agent text as Markdown, built from Preact elements only (never innerHTML). Links are shown as text with
// their host, and are never clickable: an agent can print anything, and the phone shouldn't take you there.

import type { ComponentChildren } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import { highlight } from '../lib/highlight.ts'
import { type Block, type Inline, parseInline, parseMarkdown } from '../lib/markdown.ts'
import { Check, Copy } from './icons.tsx'

export function Markdown({ text, class: cls }: { text: string; class?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <div class={cls ? `md ${cls}` : 'md'}>{blocks.map(block)}</div>
}

/** One line of inline Markdown (code, bold, links), for questions and option labels. */
export function InlineMarkdown({ text }: { text: string }) {
  const nodes = useMemo(() => parseInline(text), [text])
  return <>{inline(nodes)}</>
}

function host(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function textOf(c: Inline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : textOf(n.c))).join('')
}

function inline(nodes: Inline[]): ComponentChildren {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.v
      case 'br':
        return <br key={i} />
      case 'code':
        return <code key={i}>{n.v}</code>
      case 'strong':
        return <strong key={i}>{inline(n.c)}</strong>
      case 'em':
        return <em key={i}>{inline(n.c)}</em>
      case 'del':
        return <del key={i}>{inline(n.c)}</del>
      case 'link': {
        const label = textOf(n.c)
        const same = label === n.url || label === host(n.url)
        return (
          <span key={i} class="md-link" title={n.url}>
            {inline(n.c)}
            {!same && <span class="md-host"> ({host(n.url)})</span>}
          </span>
        )
      }
    }
    return null
  })
}

function block(b: Block, i: number): ComponentChildren {
  switch (b.t) {
    case 'p':
      return <p key={i}>{inline(b.c)}</p>
    case 'h': {
      const H = (b.level <= 2 ? 'h3' : 'h4') as 'h3' | 'h4'
      return (
        <H key={i} class={`md-h${Math.min(b.level, 4)}`}>
          {inline(b.c)}
        </H>
      )
    }
    case 'code':
      return <CodeBlock key={i} lang={b.lang} code={b.v} />
    case 'quote':
      return <blockquote key={i}>{b.c.map(block)}</blockquote>
    case 'hr':
      return <hr key={i} />
    case 'list': {
      const items = b.items.map((it, k) => (
        <li key={k} class={it.task === null ? undefined : 'task'}>
          {it.task !== null && (
            <span class={`md-check ${it.task ? 'on' : ''}`} role="img" aria-label={it.task ? 'Done' : 'Not done'}>
              {it.task && <Check />}
            </span>
          )}
          <div>{it.c.map(block)}</div>
        </li>
      ))
      return b.ordered ? (
        <ol key={i} start={b.start}>
          {items}
        </ol>
      ) : (
        <ul key={i}>{items}</ul>
      )
    }
    case 'table':
      return (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a horizontally scrolling region must be keyboard-focusable
        <div key={i} class="md-table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {b.head.map((h, k) => (
                  <th key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const tokens = useMemo(() => highlight(code, lang), [code, lang])
  const [copied, setCopied] = useState(false)
  return (
    <figure class="md-code">
      <figcaption>
        <span>{lang || 'code'}</span>
        <button
          type="button"
          class="md-copy"
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={async () => {
            await navigator.clipboard?.writeText(code).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
        >
          {copied ? <Check /> : <Copy />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a horizontally scrolling region must be keyboard-focusable */}
      <pre tabIndex={0}>
        <code>
          {tokens.map((t, k) =>
            t.k ? (
              <span key={k} class={`tk-${t.k}`}>
                {t.v}
              </span>
            ) : (
              t.v
            ),
          )}
        </code>
      </pre>
    </figure>
  )
}
