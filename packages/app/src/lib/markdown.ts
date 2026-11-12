// A small Markdown parser for what agents write: paragraphs, headings, lists (nested, numbered, tasks), fenced code,
// quotes, tables, rules, and inline code, bold, italics, strikethrough and links. It builds a plain tree; the renderer
// (`ui/markdown.tsx`) turns that into Preact elements. No HTML is ever produced or interpreted, and links stay text:
// whatever an agent prints, the phone shows it and never navigates to it.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; c: Inline[]; url: string }
  | { t: 'br' }

export type Align = 'left' | 'center' | 'right' | null

export interface ListItem {
  task: boolean | null
  c: Block[]
}

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?: +(.*))?$/
const TABLE_DELIM = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/

const indentOf = (l: string) => /^ */.exec(l)![0].length
const blank = (l: string) => l.trim() === ''

export function parseMarkdown(src: string): Block[] {
  return blocks(src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'))
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i]!
  return (
    FENCE.test(l) ||
    HEADING.test(l) ||
    RULE.test(l) ||
    QUOTE.test(l) ||
    ITEM.test(l) ||
    (l.includes('|') && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1]!) && lines[i + 1]!.includes('-'))
  )
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (blank(line)) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const mark = fence[1]!
      const close = new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`)
      const indent = indentOf(line)
      const body: string[] = []
      i++
      while (i < lines.length && !close.test(lines[i]!)) {
        const l = lines[i]!
        body.push(l.slice(Math.min(indent, indentOf(l))))
        i++
      }
      i++ // the closing fence, or past the end when the text was cut mid-block
      out.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      out.push({ t: 'h', level: heading[1]!.length, c: parseInline(heading[2] ?? '') })
      i++
      continue
    }
    if (RULE.test(line)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && !blank(lines[i]!)) {
        const q = QUOTE.exec(lines[i]!)
        if (!q && startsBlock(lines, i)) break
        body.push(q ? q[1]! : lines[i]!)
        i++
      }
      out.push({ t: 'quote', c: blocks(body) })
      continue
    }
    if (ITEM.test(line) && !RULE.test(line)) {
      i = list(lines, i, out)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
      i = table(lines, i, out)
      continue
    }
    const para: string[] = [line.trim()]
    i++
    while (i < lines.length && !blank(lines[i]!) && !startsBlock(lines, i)) {
      para.push(lines[i]!.trim())
      i++
    }
    out.push({ t: 'p', c: parseInline(para.join('\n')) })
  }
  return out
}

function list(lines: string[], start: number, out: Block[]): number {
  const first = ITEM.exec(lines[start]!)!
  const base = first[1]!.length
  const ordered = /\d/.test(first[2]!)
  const items: ListItem[] = []
  let i = start
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!)
    if (!m || RULE.test(lines[i]!)) break
    const indent = m[1]!.length
    if (indent > base + 1 || /\d/.test(m[2]!) !== ordered) break
    // One item: its first line, then everything indented under it (nested lists, code, more paragraphs), plus lazy
    // continuation lines of its last paragraph.
    const offset = indent + m[2]!.length + 1
    const body: string[] = [m[3] ?? '']
    i++
    while (i < lines.length) {
      const l = lines[i]!
      if (blank(l)) {
        // A blank line ends the item unless what follows is still indented under it.
        let j = i + 1
        while (j < lines.length && blank(lines[j]!)) j++
        if (j < lines.length && indentOf(lines[j]!) > base) {
          for (; i < j; i++) body.push('')
          continue
        }
        break
      }
      const ind = indentOf(l)
      if (ind > base) {
        body.push(l.slice(Math.min(ind, offset)))
        i++
        continue
      }
      if (ITEM.test(l) || startsBlock(lines, i) || blank(body[body.length - 1] ?? '')) break
      body.push(l.trim()) // lazy continuation
      i++
    }
    let task: boolean | null = null
    const tm = /^\[([ xX])\]\s+/.exec(body[0]!)
    if (!ordered && tm) {
      task = tm[1] !== ' '
      body[0] = body[0]!.slice(tm[0].length)
    }
    items.push({ task, c: blocks(body) })
    // Blank lines between items of the same list don't end it.
    let j = i
    while (j < lines.length && blank(lines[j]!)) j++
    const next = j < lines.length ? ITEM.exec(lines[j]!) : null
    if (next && next[1]!.length <= base + 1 && next[1]!.length >= base && /\d/.test(next[2]!) === ordered) i = j
    else break
  }
  out.push({ t: 'list', ordered, start: ordered ? Number.parseInt(first[2]!, 10) : 1, items })
  return i
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  let code = false
  for (let k = 0; k < s.length; k++) {
    const ch = s[k]!
    if (ch === '\\' && s[k + 1] === '|') {
      cur += '|'
      k++
    } else if (ch === '`') {
      code = !code
      cur += ch
    } else if (ch === '|' && !code) {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

function table(lines: string[], start: number, out: Block[]): number {
  const head = splitRow(lines[start]!)
  const align: Align[] = splitRow(lines[start + 1]!).map((d) =>
    d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : d.startsWith(':') ? 'left' : null,
  )
  const rows: Inline[][][] = []
  let i = start + 2
  while (i < lines.length && !blank(lines[i]!) && lines[i]!.includes('|')) {
    const cells = splitRow(lines[i]!)
    rows.push(head.map((_, k) => parseInline(cells[k] ?? '')))
    i++
  }
  out.push({ t: 'table', align: head.map((_, k) => align[k] ?? null), head: head.map((h) => parseInline(h)), rows })
  return i
}

// ── Inline ───────────────────────────────────────────────────────────────────────────────────────────────────────

const PUNCT = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u

function delimited(src: string, i: number, mark: string): { inner: string; end: number } | null {
  const open = i + mark.length
  if (open >= src.length || /\s/.test(src[open]!)) return null
  let k = src.indexOf(mark, open + 1)
  while (k !== -1) {
    const after = src[k + mark.length]
    const okClose = !/\s/.test(src[k - 1]!)
    // `_` never opens or closes inside a word (snake_case), and `*` closes only when not doubled into a longer run.
    const okUnderscore = mark[0] !== '_' || !after || !WORD.test(after)
    const okRun = after !== mark[0] || mark.length === 2
    if (okClose && okUnderscore && okRun) return { inner: src.slice(open, k), end: k + mark.length }
    k = src.indexOf(mark, k + 1)
  }
  return null
}

const LINK = /\[([^\]\n]*(?:\][^(\n][^\]\n]*)*)\]\(\s*<?([^\s()<>]+(?:\([^\s()]*\))?)>?(?:\s+"[^"]*")?\s*\)/y
const AUTOLINK = /<((?:https?|mailto):[^\s<>]+)>/y
const BARE_URL = /https?:\/\/[^\s<>"'`]+/y

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1]!)) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (ch === '\n') {
      flush()
      out.push({ t: 'br' })
      i++
      continue
    }
    if (ch === '`') {
      let n = 1
      while (src[i + n] === '`') n++
      const fence = '`'.repeat(n)
      let k = src.indexOf(fence, i + n)
      while (k !== -1 && src[k + n] === '`') k = src.indexOf(fence, k + n + 1)
      if (k !== -1) {
        let v = src.slice(i + n, k).replace(/\n/g, ' ')
        if (v.length > 2 && v.startsWith(' ') && v.endsWith(' ')) v = v.slice(1, -1)
        flush()
        out.push({ t: 'code', v })
        i = k + n
        continue
      }
      text += fence
      i += n
      continue
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const prev = src[i - 1]
      const double = src[i + 1] === ch
      if (ch === '_' && prev && WORD.test(prev)) {
        text += ch
        i++
        continue
      }
      if (ch === '~' && !double) {
        text += ch
        i++
        continue
      }
      const mark = double ? ch + ch : ch
      const d = delimited(src, i, mark)
      if (d) {
        flush()
        out.push({ t: ch === '~' ? 'del' : double ? 'strong' : 'em', c: parseInline(d.inner) })
        i = d.end
        continue
      }
      text += mark
      i += mark.length
      continue
    }
    if (ch === '[' || (ch === '!' && src[i + 1] === '[')) {
      const at = ch === '!' ? i + 1 : i
      LINK.lastIndex = at
      const m = LINK.exec(src)
      if (m) {
        flush()
        const label = m[1] || m[2]!
        out.push(
          ch === '!'
            ? { t: 'link', c: [{ t: 'text', v: `Image: ${label}` }], url: m[2]! }
            : { t: 'link', c: parseInline(label), url: m[2]! },
        )
        i = LINK.lastIndex
        continue
      }
    }
    if (ch === '<') {
      AUTOLINK.lastIndex = i
      const m = AUTOLINK.exec(src)
      if (m) {
        flush()
        out.push({ t: 'link', c: [{ t: 'text', v: m[1]! }], url: m[1]! })
        i = AUTOLINK.lastIndex
        continue
      }
    }
    if (ch === 'h' && (i === 0 || !WORD.test(src[i - 1]!)) && src.startsWith('http', i)) {
      BARE_URL.lastIndex = i
      const m = BARE_URL.exec(src)
      if (m) {
        // Trailing punctuation belongs to the sentence, not the URL; a closing paren only if it has no opener.
        let url = m[0]
        while (/[.,:;!?]$/.test(url) || (url.endsWith(')') && !url.includes('('))) url = url.slice(0, -1)
        flush()
        out.push({ t: 'link', c: [{ t: 'text', v: url }], url })
        i += url.length
        continue
      }
    }
    text += ch
    i++
  }
  flush()
  return out
}

// ── Plain text, for one- or two-line previews ────────────────────────────────────────────────────────────────────

function inlineText(c: Inline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : inlineText(n.c))).join('')
}

function blockText(b: Block): string {
  switch (b.t) {
    case 'p':
    case 'h':
      return inlineText(b.c)
    case 'code':
      return b.v.split('\n').find((l) => l.trim()) ?? ''
    case 'quote':
      return b.c.map(blockText).join(' ')
    case 'list':
      return b.items.map((it) => it.c.map(blockText).join(' ')).join(' · ')
    case 'table':
      return b.head.map(inlineText).join(' · ')
    case 'hr':
      return ''
  }
}

/** Markdown flattened to one line of plain text, for previews in lists and notifications. */
export function plainText(src: string): string {
  return parseMarkdown(src).map(blockText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}
