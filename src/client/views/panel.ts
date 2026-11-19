/**
 * The global panel: top bar, project rail, project workspace and settings.
 */
import { createElement as h, useEffect, useState } from 'react'

import { api } from '../api'
import { I } from '../icons'
import { t } from '../i18n'
import { readUiState, relTime, useAsync, writeUiState, type UiSelection } from '../util'
import { Button, Empty, ErrorNote, IconButton, InstancePicker, Spinner } from '../ui'
import type { InstanceInfo, Page } from '../types'
import { ProjectView } from './project'
import { SettingsView } from './settings'

export interface PanelProps {
  appCss: string
}

export function PanelPage({ appCss }: PanelProps) {
  const [ui, setUi] = useState<UiSelection>(readUiState)
  const [view, setView] = useState<'main' | 'settings'>('main')
  const [refreshKey, setRefreshKey] = useState(0)
  const [settingsTarget, setSettingsTarget] = useState('')
  const [settingsDraft, setSettingsDraft] = useState(false)
  const [query, setQuery] = useState('')
  const instancesState = useAsync<{ items: InstanceInfo[] }>(() => api('instances'), [refreshKey])

  const instances = instancesState.data?.items ?? []
  const selected = instances.find((instance) => instance.id === ui.instanceId) ?? instances[0] ?? null
  const instanceId = selected ? selected.id : ''
  const hasToken = Boolean(selected?.hasToken)

  useEffect(() => {
    if (!instancesState.data) return
    if (selected && ui.instanceId !== selected.id) {
      const next = { ...ui, instanceId: selected.id }
      setUi(next)
      writeUiState(next)
    }
  }, [instancesState.data, selected?.id])

  const projects = useAsync<Page>(
    () => (instanceId && hasToken
      ? api('projects', { query: { id: instanceId, search: query } })
      : Promise.resolve({ items: [], total: 0, page: 1, nextPage: null })),
    [instanceId, query, refreshKey, hasToken],
  )

  const openSettings = (draft = false) => {
    setSettingsTarget('')
    setSettingsDraft(draft)
    setView('settings')
    // The list may have changed since the last render; refresh it on entry.
    instancesState.reload()
  }

  const selectInstance = (id: string) => {
    const next: UiSelection = { instanceId: id, project: '' }
    setUi(next)
    writeUiState(next)
    setQuery('')
  }

  const openProject = (path: string) => {
    const next: UiSelection = { ...ui, project: path }
    setUi(next)
    writeUiState(next)
  }

  const backToProjects = () => {
    const next: UiSelection = { ...ui, project: '' }
    setUi(next)
    writeUiState(next)
  }

  const refresh = () => {
    setRefreshKey((value) => value + 1)
    instancesState.reload()
    projects.reload()
  }

  const onSearch = (value: string) => {
    setQuery(value)
    if (value !== '' && ui.project) backToProjects()
  }

  return h(
    'div',
    { className: 'gw-app' },
    h('style', { dangerouslySetInnerHTML: { __html: appCss } }),
    h(
      'header',
      { className: 'gw-top' },
      h(
        'div',
        { className: 'gw-brand' },
        h('span', { className: 'gw-logo' }, h(I.logo)),
        h('span', { className: 'gw-word' }, t('title')),
        h('span', { className: 'gw-word-sub' }, t('subtitle')),
      ),
      instances.length > 0 && view === 'main' ? h(InstancePicker, { instances, value: instanceId, onChange: selectInstance }) : null,
      view === 'main'
        ? h(
            'label',
            { className: 'gw-search' },
            h(I.search, { size: 14 }),
            h('input', {
              value: query,
              placeholder: t('search'),
              'aria-label': t('search'),
              onChange: (event: any) => onSearch(event.target.value),
            }),
          )
        : null,
      h('span', { className: 'gw-top-spacer' }),
      h(
        'div',
        { className: 'gw-top-actions' },
        view === 'main' ? h(IconButton, { label: t('refresh'), onClick: refresh }, h(I.refresh, { size: 16 })) : null,
        h(
          IconButton,
          {
            label: t('settings'),
            onClick: () => {
              if (view === 'settings') setView('main')
              else openSettings(false)
            },
          },
          h(I.settings, { size: 16 }),
        ),
      ),
    ),
    view === 'settings'
      ? h(SettingsView, {
          instances,
          initialInstanceId: settingsTarget,
          startNew: settingsDraft,
          reload: () => instancesState.reload(),
          onBack: () => {
            setView('main')
            instancesState.reload()
          },
        })
      : h(
          'div',
          { className: 'gw-shell' },
          h(
            'aside',
            { className: 'gw-rail' },
            h(
              'div',
              { className: 'gw-rail-head' },
              h('span', null, t('projects')),
              h('span', { className: 'gw-count' }, String(projects.data?.total ?? projects.data?.items?.length ?? 0)),
            ),
            h(
              'div',
              { className: 'gw-rail-search' },
              h(I.search, { size: 13 }),
              h('input', { value: query, placeholder: t('filter'), 'aria-label': t('filter'), onChange: (event: any) => setQuery(event.target.value) }),
            ),
            h(
              'div',
              { className: 'gw-projects' },
              h(ErrorNote, { error: projects.error, onRetry: projects.reload }),
              projects.loading && !projects.data ? h(Spinner) : null,
              (projects.data?.items ?? []).map((project: any) =>
                h(
                  'button',
                  {
                    key: project.id,
                    type: 'button',
                    className: `gw-project${ui.project === project.path_with_namespace ? ' is-active' : ''}`,
                    onClick: () => openProject(project.path_with_namespace),
                  },
                  h('span', { className: 'gw-avatar', style: { '--h': project.id % 360 } }, (project.name || project.path || '?').slice(0, 2).toUpperCase()),
                  h(
                    'span',
                    { className: 'gw-proj-text' },
                    h('span', { className: 'gw-proj-name' }, project.name),
                    h('span', { className: 'gw-proj-ns' }, project.namespace?.path || project.path_with_namespace?.split('/').slice(0, -1).join('/') || ''),
                  ),
                  h('span', { className: 'gw-proj-meta' }, project.last_activity_at ? relTime(project.last_activity_at) : ''),
                ),
              ),
              projects.data && projects.data.items.length === 0
                ? h('div', { className: 'gw-muted', style: { padding: '10px 12px', fontSize: 12 } }, t('noProjects'))
                : null,
            ),
            h('div', { className: 'gw-rail-foot' }, t('memberOnly')),
            h(
              'button',
              { type: 'button', className: 'gw-rail-action', onClick: () => openSettings(true) },
              h(I.plus, { size: 12 }),
              t('addInstance'),
            ),
          ),
          ui.project && selected?.hasToken
            ? h(ProjectView, {
                key: `${instanceId}:${ui.project}:${refreshKey}`,
                instanceId,
                projectPath: ui.project,
                instanceLabel: selected.label || selected.endpoint,
                onBack: backToProjects,
              })
            : h(
                'main',
                { className: 'gw-main' },
                h(
                  'div',
                  { className: 'gw-content' },
                  h(ErrorNote, { error: instancesState.error, onRetry: instancesState.reload }),
                  !instancesState.data && instancesState.loading ? h(Spinner) : null,
                  instances.length === 0
                    ? h(Empty, {
                        title: t('noInstances'),
                        hint: t('noInstancesHint'),
                        action: h(Button, { kind: 'primary', onClick: () => openSettings(true) }, t('addInstance')),
                      })
                    : selected && !selected.hasToken
                      ? h(Empty, {
                          title: t('setupTitle'),
                          hint: t('setupHint', { name: selected.label || selected.endpoint }),
                          action: h(
                            Button,
                            { kind: 'primary', onClick: () => { setSettingsTarget(selected.id); setSettingsDraft(false); setView('settings') } },
                            t('openSettings'),
                          ),
                        })
                      : h(Empty, { title: t('noProject'), hint: t('noProjectHint') }),
                ),
              ),
        ),
  )
}
