// Light syntax colouring for code blocks: comments, strings, numbers, keywords, calls, shell flags and diff lines.
// It only splits text into classed runs; joining the runs gives back the exact input.

export type TokenKind = 'kw' | 'str' | 'com' | 'num' | 'fn' | 'attr' | 'add' | 'del' | 'meta' | null
export interface Token {
  k: TokenKind
  v: string
}

const KEYWORDS = new Set(
  (
    'as async await break case catch class const continue def default defer delete do elif else enum except export ' +
    'extends false finally fn for from func function go if impl import in instanceof interface is lambda let loop ' +
    'match mod module mut new nil none not null of or package pass pub raise return self static struct super switch ' +
    'this throw true try type typeof undefined use var void while with yield True False None then fi done esac ' +
    'local readonly select where insert update into values create table and'
  ).split(' '),
)

const HASH_COMMENTS =
  /^(sh|bash|zsh|shell|console|fish|py|python|rb|ruby|ya?ml|toml|ini|conf|dockerfile|make|r|pl|perl)$/i
const DIFF = /^(diff|patch)$/i

export function highlight(code: string, lang: string): Token[] {
  const l = lang.toLowerCase()
  if (DIFF.test(l) || (!l && /^(?:diff --git|--- |@@ )/m.test(code) && /^[+-]/m.test(code))) return diff(code)
  const hash = HASH_COMMENTS.test(l)
  const shell = /^(sh|bash|zsh|shell|console|fish)$/i.test(l)
  const sql = /^sql$/i.test(l)
  const rules: [TokenKind, RegExp][] = [
    ['com', hash ? /#.*/y : sql ? /--.*/y : /\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/y],
    ['str', /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?/y],
    ['num', /\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y],
    ['attr', shell ? /(?<=\s)--?[A-Za-z][\w-]*/y : /(?!)/y],
    [null, /[A-Za-z_$][\w$]*/y],
  ]
  const out: Token[] = []
  const push = (k: TokenKind, v: string) => {
    const last = out[out.length - 1]
    if (last && last.k === k) last.v += v
    else out.push({ k, v })
  }
  let i = 0
  outer: while (i < code.length) {
    for (const [kind, re] of rules) {
      re.lastIndex = i
      const m = re.exec(code)
      if (!m?.[0]) continue
      let k = kind
      if (kind === null) {
        if (KEYWORDS.has(m[0])) k = 'kw'
        else if (code[i + m[0].length] === '(') k = 'fn'
      }
      push(k, m[0])
      i += m[0].length
      continue outer
    }
    push(null, code[i]!)
    i++
  }
  return out
}

function diff(code: string): Token[] {
  return code.split(/(?<=\n)/).map((line) => ({
    k: line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'meta' : null,
    v: line,
  }))
}
