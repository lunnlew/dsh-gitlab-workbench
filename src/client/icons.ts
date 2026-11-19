/**
 * The sampling of line icons the panel draws. They share one 24px grid, a
 * 1.75 stroke and round caps, so they read as one set.
 */
import { createElement as h } from 'react'

export interface IconOptions {
  size?: number
  fill?: boolean
  style?: Record<string, unknown>
}

/** Build one stroke icon from path data. */
export function icon(paths: string[], options: IconOptions = {}) {
  return h(
    'svg',
    {
      className: 'gw-i',
      viewBox: '0 0 24 24',
      width: options.size ?? 16,
      height: options.size ?? 16,
      fill: options.fill ? 'currentColor' : 'none',
      stroke: options.fill ? 'none' : 'currentColor',
      strokeWidth: 1.75,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
    paths.map((d, index) => h('path', { key: index, d })),
  )
}

export const I: Record<string, (p?: any) => any> = {
  logo: () => h(
    'svg',
    {
      className: 'gw-i',
      viewBox: '0 0 24 24',
      width: 16,
      height: 16,
      fill: 'none',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
    h('path', { d: 'M6 4v10a4 4 0 0 0 4 4h3', stroke: 'currentColor' }),
    h('circle', { cx: 6, cy: 4, r: 1.7, fill: 'currentColor' }),
    h('circle', { cx: 18, cy: 7, r: 2.3, fill: 'currentColor' }),
    h('circle', { cx: 13, cy: 18, r: 2.3, fill: 'currentColor' }),
    h('path', { d: 'M18 9.3v1.2a3.5 3.5 0 0 1-3.5 3.5H15', stroke: 'currentColor' }),
  ),
  search: (p?: IconOptions) => icon(['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M20 20l-3.6-3.6'], p),
  refresh: (p?: IconOptions) => icon(['M20 11a8 8 0 1 0-2.3 6.3', 'M20 4v7h-7'], p),
  settings: (p?: IconOptions) => h(
    'svg',
    {
      className: 'gw-i',
      viewBox: '0 0 24 24',
      width: p?.size ?? 16,
      height: p?.size ?? 16,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
    h('circle', { cx: 12, cy: 12, r: 3 }),
    h('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z' }),
  ),
  chevron: (p?: IconOptions) => icon(['M9 6l6 6-6 6'], p),
  down: (p?: IconOptions) => icon(['M6 9l6 6 6-6'], p),
  external: (p?: IconOptions) => icon(['M14 4h6v6', 'M20 4l-9 9', 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5'], p),
  branch: (p?: IconOptions) => icon(
    ['M6 4v11', 'M6 19m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0', 'M18 7m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0', 'M18 9.2v1.3a4.5 4.5 0 0 1-4.5 4.5H10'],
    p,
  ),
  tag: (p?: IconOptions) => icon(['M3 3h9l9 9-9 9-9-9Z', 'M7.5 7.5h.01'], p),
  commit: (p?: IconOptions) => icon(
    ['M12 12m-3.4 0a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0', 'M3 12h5.6', 'M15.4 12H21'],
    p,
  ),
  folder: (p?: IconOptions) => icon(['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'], p),
  file: (p?: IconOptions) => icon(['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z', 'M14 3v5h5'], p),
  lock: (p?: IconOptions) => icon(['M5 10h14v10H5Z', 'M8 10V7a4 4 0 0 1 8 0v3'], p),
  terminal: (p?: IconOptions) => icon(['M4 6l5 5-5 5', 'M12 17h8'], p),
  play: (p?: IconOptions) => icon(['M8 5.5l10 6.5-10 6.5Z'], p),
  stop: (p?: IconOptions) => icon(['M7 7h10v10H7Z'], p),
  x: (p?: IconOptions) => icon(['M18 6L6 18', 'M6 6l12 12'], p),
  plus: (p?: IconOptions) => icon(['M12 5v14', 'M5 12h14'], p),
  trash: (p?: IconOptions) => icon(['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'], p),
  check: (p?: IconOptions) => icon(['M20 6L9 17l-5-5'], p),
  info: (p?: IconOptions) => icon(['M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0', 'M12 11v5'], p),
}
