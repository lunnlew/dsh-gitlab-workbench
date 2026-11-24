/**
 * The project overview: counters, the latest pipelines for the selected branch,
 * and a paginated commit history.
 */
import { createElement as h, useEffect, useState } from 'react'

import { api } from '../api'
import { I } from '../icons'
import { t } from '../i18n'
import { isActivePipelineStatus, pipelineDuration, relTime, shortSha, useAsync, usePolling } from '../util'
import { Button, ErrorNote, SectionHead, Spinner, Status } from '../ui'
import type { Page } from '../types'

export interface OverviewTabProps {
  instanceId: string
  projectPath: string
  project: any
  counts: { openMergeRequests?: number | null }
  refName: string
  onOpenPipelines?: () => void
}

export function OverviewTab({ instanceId, projectPath, project, counts, refName, onOpenPipelines }: OverviewTabProps) {
  const pipelines = useAsync<Page<any>>(
    () => api('pipelines', { query: { id: instanceId, path: projectPath, ref: refName } }),
    [instanceId, projectPath, refName],
  )
  const commits = useAsync(
    () => api('commits', { query: { id: instanceId, path: projectPath, ref: refName || project.default_branch } }),
    [instanceId, projectPath, refName, project.default_branch],
  )

  // A running pipeline should turn into success/failure without a manual
  // refresh; poll only while something is still in flight.
  usePolling(
    pipelines.reload,
    (pipelines.data?.items ?? []).some((pipeline: any) => isActivePipelineStatus(pipeline.status)),
    8000,
  )

  const [more, setMore] = useState<any[]>([])
  const [moreBusy, setMoreBusy] = useState(false)

  useEffect(() => {
    setMore([])
  }, [instanceId, projectPath, refName])

  const commitItems = [...(commits.data?.items ?? []), ...more]
  const nextPage = commits.data?.nextPage ?? null

  const loadMore = async () => {
    if (!nextPage || moreBusy) return
    setMoreBusy(true)
    try {
      const page = await api('commits', {
        query: { id: instanceId, path: projectPath, ref: refName || project.default_branch, page: nextPage },
      })
      setMore((current) => [...current, ...(page.items ?? [])])
    } finally {
      setMoreBusy(false)
    }
  }

  return h(
    'div',
    { className: 'gw-content' },
    h(
      'section',
      { className: 'gw-stats', 'aria-label': t('projects') },
      h('div', { className: 'gw-stat' }, h('div', { className: 'gw-stat-num' }, String(project.open_issues_count ?? 0)), h('div', { className: 'gw-stat-label' }, t('openIssues'))),
      h('div', { className: 'gw-stat' }, h('div', { className: 'gw-stat-num' }, String(counts?.openMergeRequests ?? '—')), h('div', { className: 'gw-stat-label' }, t('openMergeRequests'))),
      h('div', { className: 'gw-stat' }, h('div', { className: 'gw-stat-num' }, String(project.star_count ?? 0)), h('div', { className: 'gw-stat-label' }, t('stars'))),
      h('div', { className: 'gw-stat' }, h('div', { className: 'gw-stat-num' }, String(project.forks_count ?? 0)), h('div', { className: 'gw-stat-label' }, t('forks'))),
    ),
    h(
      'section',
      { className: 'gw-block' },
      h(SectionHead, {
        title: t('recentPipelines'),
        link: onOpenPipelines ? `${t('allPipelines')} →` : undefined,
        onLink: onOpenPipelines,
      }),
      h(ErrorNote, { error: pipelines.error, onRetry: pipelines.reload }),
      pipelines.loading && !pipelines.data ? h(Spinner) : null,
      h(
        'div',
        { className: 'gw-pipe-mini' },
        pipelines.data && pipelines.data.ciDisabled
          ? h(
              'div',
              { className: 'gw-muted', style: { padding: '14px 16px' } },
              pipelines.data.reason === 'empty_repo' ? t('emptyRepoHint') : t('ciOffHint'),
            )
          : pipelines.data && pipelines.data.items.length === 0
            ? h(
                'div',
                { className: 'gw-muted', style: { padding: '14px 16px' } },
                refName ? t('noPipelinesBranch', { ref: refName }) : t('noPipelines'),
              )
            : (pipelines.data?.items ?? []).slice(0, 3).map((pipeline: any) =>
              h(
                'div',
                { key: pipeline.id, className: 'gw-list-row' },
                h(Status, { status: pipeline.status }),
                h('span', { className: 'gw-pipe-id' }, `#${pipeline.id}`),
                h('span', { className: 'gw-pipe-ref' }, h(I.branch, { size: 12 }), pipeline.ref),
                h('span', { className: 'gw-mono gw-muted' }, shortSha(pipeline.sha)),
                h('span', { className: 'gw-pipe-duration' }, pipelineDuration(pipeline)),
                h('span', { className: 'gw-row-time' }, relTime(pipeline.created_at)),
              ),
            ),
      ),
    ),
    h(
      'section',
      { className: 'gw-block' },
      h(SectionHead, {
        title: t('recentCommits'),
        link: h('span', { className: 'gw-inline' }, t('openInGitLab'), h(I.external, { size: 12 })),
        onLink: () => window.open(`${project.web_url}/-/commits/${encodeURIComponent(refName || project.default_branch)}`, '_blank', 'noopener'),
      }),
      h(ErrorNote, { error: commits.error, onRetry: commits.reload }),
      commits.loading && !commits.data ? h(Spinner) : null,
      h(
        'div',
        { className: 'gw-list gw-commit-list' },
        commitItems.map((commit: any) =>
          h(
            'div',
            { key: commit.id, className: 'gw-list-row' },
            h('span', { className: 'gw-mono gw-muted' }, commit.short_id ?? shortSha(commit.id)),
            h('span', { className: 'gw-commit' }, h('span', { className: 'gw-commit-title' }, commit.title)),
            h('span', { className: 'gw-commit-author' }, commit.author_name || ''),
            h('span', { className: 'gw-row-time' }, commit.authored_date ? relTime(commit.authored_date) : ''),
          ),
        ),
        commitItems.length === 0 && commits.data ? h('div', { className: 'gw-muted gw-list-empty' }, t('noCommits')) : null,
      ),
      nextPage
        ? h(
            'div',
            { className: 'gw-tree-more' },
            h(Button, { kind: 'ghost', onClick: loadMore, disabled: moreBusy }, moreBusy ? t('loading') : t('loadMore')),
          )
        : null,
    ),
  )
}
