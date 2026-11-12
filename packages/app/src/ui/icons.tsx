// One small authored icon set: 24px grid, 1.75 stroke, round caps and joins.

import type { JSX } from 'preact'

function Icon(props: { d: string | string[]; label?: string; class?: string }): JSX.Element {
  const paths = Array.isArray(props.d) ? props.d : [props.d]
  return (
    <svg
      class={`icon ${props.class ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={props.label ? undefined : 'true'}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
    >
      {paths.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  )
}

export const Check = () => <Icon d="M5 12.5l4.5 4.5L19 7.5" />
export const Cross = () => <Icon d={['M6.5 6.5l11 11', 'M17.5 6.5l-11 11']} />
export const Back = () => <Icon d="M15 5l-7 7 7 7" />
export const Send = () => <Icon d={['M12 19V6', 'M6.5 11.5L12 6l5.5 5.5']} />
export const Gear = () => (
  <Icon
    d={[
      'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
      'M19.4 13.5l1.5 1.2-1.8 3.1-1.8-.6a7.6 7.6 0 0 1-1.9 1.1l-.3 1.9h-3.6l-.3-1.9a7.6 7.6 0 0 1-1.9-1.1l-1.8.6-1.8-3.1 1.5-1.2a7.4 7.4 0 0 1 0-3l-1.5-1.2 1.8-3.1 1.8.6a7.6 7.6 0 0 1 1.9-1.1L10.2 3h3.6l.3 1.9a7.6 7.6 0 0 1 1.9 1.1l1.8-.6 1.8 3.1-1.5 1.2a7.4 7.4 0 0 1 0 3z',
    ]}
  />
)
export const BellOff = () => (
  <Icon
    d={[
      'M9.5 20a2.6 2.6 0 0 0 5 0',
      'M17.6 13.4V10a5.6 5.6 0 0 0-8.9-4.5',
      'M6.4 8.6c-.1.4-.1.9-.1 1.4v3.6L4.5 17h11.9',
      'M3.5 3.5l17 17',
    ]}
  />
)
export const Alert = () => (
  <Icon
    d={[
      'M12 8v5',
      'M12 16.5v.01',
      'M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
    ]}
  />
)
export const Offline = () => (
  <Icon
    d={[
      'M2.5 8.6a14 14 0 0 1 19 0',
      'M5.5 12.3a9.5 9.5 0 0 1 13 0',
      'M8.7 15.9a4.8 4.8 0 0 1 6.6 0',
      'M12 19.5h.01',
      'M4 3.5l16 17',
    ]}
  />
)
export const Copy = () => <Icon d={['M9 9h10v10H9z', 'M5 15V5h10']} />
export const Clock = () => <Icon d={['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5V12l3 2']} />
