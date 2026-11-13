// One authored icon set: 24px grid, 1.75 stroke, round caps and joins. Plus the AgentWatch mark.

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
export const Chevron = () => <Icon d="M9.5 6l6 6-6 6" />
export const Send = () => <Icon d={['M12 19V6', 'M6.5 11.5L12 6l5.5 5.5']} />
// A six-tooth cog, generated on the grid (tips r 9.2, roots r 6.9, hub r 3): reads cleanly at 18px.
export const Gear = () => (
  <Icon
    d={[
      'M9.98 5.40L10.24 2.97A9.2 9.2 0 0 1 13.76 2.97L14.02 5.40A6.9 6.9 0 0 1 16.71 6.95L18.94 5.96A9.2 9.2 0 0 1 20.70 9L18.72 10.45A6.9 6.9 0 0 1 18.72 13.55L20.70 15A9.2 9.2 0 0 1 18.94 18.04L16.71 17.05A6.9 6.9 0 0 1 14.02 18.60L13.76 21.03A9.2 9.2 0 0 1 10.24 21.03L9.98 18.60A6.9 6.9 0 0 1 7.29 17.05L5.06 18.04A9.2 9.2 0 0 1 3.30 15L5.28 13.55A6.9 6.9 0 0 1 5.28 10.45L3.30 9A9.2 9.2 0 0 1 5.06 5.96L7.29 6.95A6.9 6.9 0 0 1 9.98 5.40Z',
      'M12 9.0a3.0 3.0 0 1 0 0 6.0a3.0 3.0 0 1 0 0 -6.0z',
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
export const Copy = () => (
  <Icon d={['M9.5 9.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z', 'M5.5 15h-1V4.5h10.5v1']} />
)
export const Clock = () => <Icon d={['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5V12l3 2']} />
export const Terminal = () => <Icon d={['M4 6.5l5 5-5 5', 'M11.5 17.5H20']} />
export const FileEdit = () => (
  <Icon
    d={['M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z', 'M13.5 3.5V9H19', 'M9 15.5h6', 'M12 12.5v6']}
  />
)
export const Question = () => (
  <Icon
    d={['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8', 'M12 17v.01']}
  />
)
export const Laptop = () => (
  <Icon d={['M5 6.5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1V15H5z', 'M2.5 18.5h19', 'M5 15l-2.5 3.5', 'M19 15l2.5 3.5']} />
)
export const Phone = () => (
  <Icon
    d={[
      'M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z',
      'M11 18.5h2',
    ]}
  />
)
export const Reply = () => <Icon d={['M9.5 7.5L4.5 12l5 4.5', 'M4.5 12h9a6 6 0 0 1 6 6v1']} />
export const Stop = () => <Icon d="M7 7h10v10H7z" />

/** The AgentWatch mark: a watch ring with a live core, the same drawing as the app icon. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg class="mark-logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="aw-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#5ee7ff" />
          <stop offset="1" stop-color="#9b87ff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0b0e1c" />
      <path
        d="M32 12.5a19.5 19.5 0 1 1-17.6 11.1"
        fill="none"
        stroke="url(#aw-g)"
        stroke-width="5"
        stroke-linecap="round"
      />
      <circle cx="17.2" cy="17.6" r="3.6" fill="#ffb547" />
      <circle cx="32" cy="32" r="7.5" fill="url(#aw-g)" />
    </svg>
  )
}
