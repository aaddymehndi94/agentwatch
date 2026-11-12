// The top bar: frosted, sticky, with a hairline that fades in once the page scrolls under it.

import type { ComponentChildren } from 'preact'
import { Back } from './icons.tsx'

export function TopBar(props: {
  back?: () => void
  title: ComponentChildren
  sub?: ComponentChildren
  children?: ComponentChildren
}) {
  return (
    <header class="bar">
      {props.back && (
        <button type="button" class="icon-btn" onClick={props.back} aria-label="Back to inbox">
          <Back />
        </button>
      )}
      <div class="bar-text">
        <div class="bar-title">{props.title}</div>
        {props.sub && <div class="bar-sub">{props.sub}</div>}
      </div>
      {props.children && <div class="bar-end">{props.children}</div>}
    </header>
  )
}
