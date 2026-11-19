/**
 * The project workspace: header, tabs, and the active tab's view.
 */
import { createElement as h, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { I } from '../icons'
import { t } from '../i18n'
import { useAsync } from '../util'
import { BranchPicker, ErrorNote, IconButton, Spinner, type RefOption } from '../ui'
import type { ProjectDetailResponse } from '../types'
import { FilesTab } from './files'
import { IssuesTab } from './issues'
import { MergeRequestsTab } from './mergeRequests'
import { OverviewTab } from './overview'
import { PipelinesTab } from './pipelines'

export interface ProjectViewProps {
  instanceId: string
  projectPath: string
  instanceLabel: string
  onBack: () => void
}

type TabId = 'overview' | 'pipelines' | 'mrs' | 'issues' | 'files'

/** Stored value meaning "no ref filter" (all branches and tags). */
const ALL_REFS = '__all__'

export function ProjectView({ instanceId, projectPath, instanceLabel, onBack }: ProjectViewProps) {
  const [tab, setTab] = useState<TabId>('overview')
  const storageKey = `dsh-gitlab-workbench:branch:${instanceId}:${projectPath}`
  const [ref, setRef] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey)
      return saved === ALL_REFS ? '' : saved || ''
    } catch {
      return ''
    }
  })
  const restored = useRef(false)
  const detail = useAsync<ProjectDetailResponse>(
    () => api('project', { query: { id: instanceId, path: projectPath } }),
    [instanceId, projectPath],
  )
  const branches = useAsync(
    () => api('branches', { query: { id: instanceId, path: projectPath } }),
    [instanceId, projectPath],
  )
  const tags = useAsync(
    () => api('tags', { query: { id: instanceId, path: projectPath } }),
    [instanceId, projectPath],
  )
  const project = detail.data?.project
  const namespace = projectPath.includes('/') ? projectPath.slice(0, projectPath.lastIndexOf('/')) : instanceLabel

  // Restore the remembered ref once the project is known: a branch, a tag, or
  // '' for "all refs". Only a first visit falls back to the default branch.
  useEffect(() => {
    if (!project || restored.current) return
    restored.current = true
    let saved: string | null = null
    try {
      saved = window.localStorage.getItem(storageKey)
    } catch {
      saved = null
    }
    if (saved === null) setRef(project.default_branch || '')
    else setRef(saved === ALL_REFS ? '' : saved)
  }, [project, storageKey])

  // A branch or tag that was deleted in the meantime falls back to the default.
  useEffect(() => {
    const names: string[] = [
      ...(branches.data?.items ?? []).map((branch: any) => branch.name),
      ...(tags.data?.items ?? []).map((tag: any) => tag.name),
    ]
    if (names.length === 0) return
    setRef((current) => (current && !names.includes(current) ? project?.default_branch || '' : current))
  }, [branches.data, tags.data, project?.default_branch])

  useEffect(() => {
    if (!restored.current) return
    try {
      window.localStorage.setItem(storageKey, ref === '' ? ALL_REFS : ref)
    } catch {
      // Private browsing may refuse storage; the ref still works for this view.
    }
  }, [storageKey, ref])

  const refOptions: RefOption[] = [
    { name: '', kind: 'all' },
    ...(branches.data?.items ?? []).map((branch: any) => ({ name: branch.name, kind: 'branch' as const })),
    ...(tags.data?.items ?? []).map((tag: any) => ({ name: tag.name, kind: 'tag' as const })),
  ]
  if (ref && !refOptions.some((option) => option.name === ref)) refOptions.splice(1, 0, { name: ref, kind: 'branch' })

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'overview', label: t('overview') },
    { id: 'pipelines', label: t('pipeline') },
    { id: 'mrs', label: t('mergeRequests') },
    { id: 'issues', label: t('issues') },
    { id: 'files', label: t('files') },
  ]

  return h(
    'main',
    { className: 'gw-main' },
    h(
      'div',
      { className: 'gw-head' },
      h(
        'div',
        { className: 'gw-crumbs' },
        h('button', { type: 'button', className: 'gw-crumb', onClick: onBack }, instanceLabel),
        h('span', null, '/'),
        h('span', null, namespace),
      ),
      h(
        'div',
        { className: 'gw-head-row' },
        h(
          'div',
          { className: 'gw-head-text' },
          h(
            'div',
            { className: 'gw-title-row' },
            h('h1', { className: 'gw-h1' }, project?.name || projectPath.split('/').pop()),
            project?.visibility === 'private' ? h('span', { className: 'gw-chip' }, h(I.lock, { size: 11 }), t('private')) : null,
            refOptions.length > 1
              ? h(BranchPicker, {
                  value: ref,
                  options: refOptions,
                  onChange: (name: string) => setRef(name),
                  label: t('branchLabel'),
                })
              : project?.default_branch
                ? h('span', { className: 'gw-chip mono' }, project.default_branch)
                : null,
          ),
          project?.description ? h('p', { className: 'gw-desc' }, project.description) : null,
        ),
        h(
          'div',
          { className: 'gw-head-actions' },
          project?.web_url
            ? h('a', { className: 'gw-btn is-ghost', href: project.web_url, target: '_blank', rel: 'noreferrer noopener' }, t('openInGitLab'), h(I.external, { size: 13 }))
            : null,
          h(IconButton, { label: t('refresh'), onClick: detail.reload }, h(I.refresh, { size: 16 })),
        ),
      ),
    ),
    h(
      'nav',
      { className: 'gw-tabs', 'aria-label': t('project') },
      tabs.map((item) =>
        h(
          'button',
          { key: item.id, type: 'button', className: `gw-tab${tab === item.id ? ' is-active' : ''}`, onClick: () => setTab(item.id) },
          item.label,
        ),
      ),
    ),
    h(ErrorNote, { error: detail.error, onRetry: detail.reload }),
    detail.loading && !project ? h(Spinner) : null,
    project
      ? tab === 'overview'
        ? h(OverviewTab, {
            instanceId,
            projectPath,
            project,
            refName: ref,
            counts: { openMergeRequests: detail.data?.openMergeRequests },
            onOpenPipelines: () => setTab('pipelines'),
          })
        : tab === 'pipelines'
          ? h(PipelinesTab, { instanceId, projectPath, refName: ref })
          : tab === 'mrs'
            ? h(MergeRequestsTab, { instanceId, projectPath })
            : tab === 'issues'
              ? h(IssuesTab, { instanceId, projectPath })
              : h(FilesTab, { key: `${projectPath}:${ref}`, instanceId, projectPath, project, refName: ref })
      : null,
  )
}
