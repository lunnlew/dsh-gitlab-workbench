/**
 * Small presentational primitives shared by every view: status, buttons, empty
 * state, error note, metadata grid and the instance picker.
 */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'

import { I } from './icons'
import { t } from './i18n'
import { errorText, statusText, statusTone } from './util'
import type { InstanceInfo } from './types'

export function Dot({ tone = 'idle' }: { tone?: string }) {
  return h('span', { className: `gw-dot${tone === 'idle' ? '' : ` is-${tone}`}` })
}

/**
 * The branch selector beside the project name: a small trigger that opens a
 * searchable list. The search field filters as you type; Enter picks the first
 * match and Escape closes the list.
 */
export interface RefOption {
  name: string
  kind: 'branch' | 'tag' | 'all'
}

export function BranchPicker({
  value,
  options,
  onChange,
  label,
}: {
  value: string
  options: RefOption[]
  onChange: (name: string) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement | null>(null)
  const search = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return undefined
    setQuery('')
    const timer = setTimeout(() => search.current?.focus(), 0)
    const onDocument = (event: any) => {
      if (box.current && !box.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocument)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onDocument)
    }
  }, [open])

  const needle = query.trim().toLowerCase()
  const current = options.find((option) => option.name === value)
  const matches = query.trim() === ''
    ? options
    : options.filter((option) => option.kind !== 'all' && option.name.toLowerCase().includes(needle))
  const choose = (name: string) => {
    onChange(name)
    setOpen(false)
  }

  return h(
    'div',
    { className: 'gw-branch-picker', ref: box },
    h(
      'button',
      {
        type: 'button',
        className: 'gw-branch',
        onClick: () => setOpen((current) => !current),
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
        title: label,
      },
      current?.kind === 'tag' ? h(I.tag, { size: 12 }) : h(I.branch, { size: 12 }),
      h('span', { className: 'gw-branch-name' }, current ? current.name || t('allRefs') : value || t('allRefs')),
      h(I.chevron, { size: 11, className: 'gw-branch-caret' }),
    ),
    open
      ? h(
          'div',
          { className: 'gw-popover', role: 'listbox' },
          h('input', {
            ref: search,
            className: 'gw-input gw-popover-search',
            placeholder: t('searchBranch'),
            value: query,
            onChange: (event: any) => setQuery(event.target.value),
            onKeyDown: (event: any) => {
              if (event.key === 'Escape') setOpen(false)
              else if (event.key === 'Enter' && matches[0]) choose(matches[0].name)
            },
          }),
          h(
            'div',
            { className: 'gw-popover-list' },
            [
              { title: '', items: matches.filter((option) => option.kind === 'all'), empty: '' },
              { title: t('branches'), items: matches.filter((option) => option.kind === 'branch'), empty: t('noBranch') },
              { title: t('tags'), items: matches.filter((option) => option.kind === 'tag'), empty: t('noTags') },
            ].map((group) => {
              if (group.items.length === 0 && (group.title === '' || query.trim() !== '')) return null
              return h(
                'div',
                { key: group.title || 'all', className: 'gw-popover-group' },
                group.title ? h('div', { className: 'gw-popover-group-title' }, group.title) : null,
                group.items.length === 0
                  ? h('div', { className: 'gw-muted', style: { padding: '4px 9px 6px' } }, group.empty)
                  : group.items.map((option) =>
                      h(
                        'button',
                        {
                          key: option.name || 'all',
                          type: 'button',
                          role: 'option',
                          'aria-selected': option.name === value,
                          className: `gw-popover-item${option.name === value ? ' is-active' : ''}`,
                          onClick: () => choose(option.name),
                        },
                        option.kind === 'tag' ? h(I.tag, { size: 12 }) : h(I.branch, { size: 12 }),
                        h('span', { className: 'gw-branch-name' }, option.name || t('allRefs')),
                      ),
                    ),
                group.title === '' && group.items.length > 0
                  ? h('div', { className: 'gw-popover-divider' })
                  : null,
              )
            }),
            matches.length === 0
              ? h('div', { className: 'gw-muted', style: { padding: '8px 10px' } }, t('noBranch'))
              : null,
          ),
        )
      : null,
  )
}

export function Status({ status, label }: { status: string; label?: string }) {
  return h(
    'span',
    { className: `gw-status is-${statusTone(status)}` },
    h('span', { className: 'gw-dot' }),
    label ?? statusText(status),
  )
}

export interface ButtonProps {
  children?: ReactNode
  onClick?: (event: any) => void
  kind?: '' | 'primary' | 'ghost' | 'danger'
  small?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
}

export function Button({ children, onClick, kind = '', small, disabled, type = 'button', title }: ButtonProps) {
  return h(
    'button',
    {
      type,
      className: `gw-btn${kind ? ` is-${kind}` : ''}${small ? ' is-sm' : ''}`,
      onClick,
      disabled: Boolean(disabled),
      title: title ?? undefined,
    },
    children,
  )
}

export function IconButton({ label, onClick, children, disabled }: { label: string; onClick?: () => void; children?: ReactNode; disabled?: boolean }) {
  return h(
    'button',
    { type: 'button', className: 'gw-icon-btn', onClick, disabled: Boolean(disabled), 'aria-label': label, title: label },
    children,
  )
}

export function Spinner({ label }: { label?: string }) {
  return h(
    'div',
    { className: 'gw-loading', role: 'status' },
    h('span', { className: 'gw-spinner' }),
    h('span', null, label ?? t('loading')),
  )
}

export function Empty({ title, hint, action, icon }: { title?: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return h(
    'div',
    { className: 'gw-empty' },
    h('div', { className: 'gw-empty-icon' }, icon ?? h(I.branch, { size: 18 })),
    h('h3', null, title ?? t('noSelection')),
    hint ? h('p', null, hint) : null,
    action ? h('div', { className: 'gw-empty-action' }, action) : null,
  )
}

export function ErrorNote({ error, onRetry }: { error: any; onRetry?: () => void }) {
  if (!error) return null
  return h(
    'div',
    { className: 'gw-error', role: 'alert' },
    h('div', { className: 'gw-error-title' }, t('errorGeneric')),
    h('div', { className: 'gw-error-text' }, errorText(error)),
    error.detail ? h('div', { className: 'gw-error-detail' }, error.detail) : null,
    onRetry ? h(Button, { kind: 'ghost', small: true, onClick: onRetry }, t('retry')) : null,
  )
}

export function MetaGrid({ items }: { items: Array<[string, ReactNode]> }) {
  return h(
    'dl',
    { className: 'gw-meta-grid' },
    items.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value))),
  )
}

export function SectionHead({ title, link, onLink }: { title: string; link?: ReactNode; onLink?: () => void }) {
  return h(
    'div',
    { className: 'gw-block-head' },
    h('h2', null, title),
    link ? h('button', { type: 'button', className: 'gw-block-link', onClick: onLink }, link) : null,
  )
}

export function LabelList({ labels }: { labels?: string[] }) {
  if (!Array.isArray(labels) || labels.length === 0) return null
  return h(
    'span',
    { className: 'gw-labels' },
    labels.slice(0, 4).map((label) => h('span', { key: label, className: 'gw-label' }, label)),
  )
}

export function InstancePicker({ instances, value, onChange }: { instances: InstanceInfo[]; value: string; onChange: (id: string) => void }) {
  const current = instances.find((item) => item.id === value)
  return h(
    'span',
    { className: 'gw-instance' },
    h('span', { className: `gw-dot${current?.status?.ok === false ? ' is-bad' : current?.hasToken ? ' is-ok' : ''}` }),
    h(
      'select',
      {
        className: 'gw-instance-select',
        value,
        'aria-label': t('settings'),
        onChange: (event: any) => onChange(event.target.value),
      },
      instances.map((instance) => h('option', { key: instance.id, value: instance.id }, instance.label || instance.endpoint)),
    ),
    h(I.down, { size: 12 }),
  )
}
