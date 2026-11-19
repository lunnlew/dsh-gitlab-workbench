/**
 * The client plugin: language detection, the sidebar entry and the main panel.
 */
import { createElement as h } from 'react'

import { setLanguage, t } from './i18n'
import appCss from './styles/app.css'
import { PanelPage } from './views/panel'

export const PANEL_ID = 'gitlab-workbench'

export interface ClientContext {
  locale?: {
    getLocale?: () => { id?: string; locale?: string; localeId?: string }
    getSnapshot?: () => { id?: string; locale?: string; localeId?: string }
  }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(options: Record<string, unknown>, component: (props: any) => unknown): () => void
  }
}

/** The left sidebar icon; `active` marks the selected panel. */
function PanelIcon({ size = 18, active = false }: { size?: number; active?: boolean }) {
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
      style: { display: 'block', opacity: active ? 1 : 0.86 },
    },
    h('path', { d: 'M6 4v10a4 4 0 0 0 4 4h3' }),
    h('circle', { cx: 6, cy: 4, r: 1.6 }),
    h('circle', { cx: 18, cy: 7, r: 2.2 }),
    h('circle', { cx: 13, cy: 18, r: 2.2 }),
    h('path', { d: 'M18 9.2v1.3a3.5 3.5 0 0 1-3.5 3.5H15' }),
  )
}

const plugin = {
  name: 'gitlab-workbench',
  inject: ['slots'],
  apply(ctx: ClientContext): void {
    try {
      const snapshot = ctx.locale?.getLocale?.() ?? ctx.locale?.getSnapshot?.()
      setLanguage(snapshot?.id ?? snapshot?.locale ?? snapshot?.localeId)
    } catch {
      // A build without the locale service keeps the browser language.
    }
    const Page = () => h(PanelPage, { appCss })
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Page))
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('panel') }, PanelIcon),
    )
  },
}

export default plugin
