/**
 * Issues: the project's list and one issue's details.
 */
import { createElement as h, useState } from 'react'

import { api } from '../api'
import { I } from '../icons'
import { t } from '../i18n'
import { relTime, useAsync } from '../util'
import { Empty, ErrorNote, IconButton, LabelList, Spinner, Status } from '../ui'

function IssueDetail({ instanceId, projectPath, iid, onBack }: { instanceId: string; projectPath: string; iid: number; onBack: () => void }) {
  const { data, error, loading, reload } = useAsync(
    () => api('issue', { query: { id: instanceId, path: projectPath, iid } }),
    [instanceId, projectPath, iid],
  )
  return h(
    'div',
    { className: 'gw-detail' },
    h(
      'div',
      { className: 'gw-detail-head' },
      h(IconButton, { label: t('back'), onClick: onBack }, h(I.chevron, { size: 14, style: { transform: 'rotate(180deg)' } })),
      h('span', { className: 'gw-detail-kicker gw-mono' }, `#${data?.iid ?? iid}`),
      data ? h(Status, { status: data.state }) : null,
      h('span', { className: 'gw-top-spacer' }),
      data?.web_url
        ? h('a', { className: 'gw-btn is-ghost is-sm', href: data.web_url, target: '_blank', rel: 'noreferrer noopener' }, t('openInGitLab'), h(I.external, { size: 12 }))
        : null,
    ),
    h(ErrorNote, { error, onRetry: reload }),
    loading && !data ? h(Spinner) : null,
    data
      ? h(
          'div',
          { className: 'gw-detail-body' },
          h('h2', { className: 'gw-detail-title' }, data.title),
          h(
            'div',
            { className: 'gw-detail-meta' },
            h('span', null, `${t('author')}：${data.author?.name || data.author?.username || '—'}`),
            h('span', null, relTime(data.updated_at)),
            Array.isArray(data.assignees) && data.assignees.length > 0
              ? h('span', null, `${t('assignees')}：${data.assignees.map((user: any) => user.name || user.username).join(', ')}`)
              : null,
          ),
          h(LabelList, { labels: data.labels }),
          h('h3', { className: 'gw-subhead' }, t('description')),
          h('pre', { className: 'gw-description' }, data.description || t('noDescription')),
        )
      : null,
  )
}

export function IssuesTab({ instanceId, projectPath }: { instanceId: string; projectPath: string }) {
  const [state, setState] = useState('opened')
  const [selected, setSelected] = useState<number | null>(null)
  const list = useAsync(
    () => api('issues', { query: { id: instanceId, path: projectPath, state } }),
    [instanceId, projectPath, state],
  )

  if (selected) {
    return h(IssueDetail, { instanceId, projectPath, iid: selected, onBack: () => setSelected(null) })
  }

  return h(
    'div',
    { className: 'gw-content' },
    h(
      'div',
      { className: 'gw-toolbar' },
      h(
        'select',
        { className: 'gw-input gw-select', value: state, onChange: (event: any) => setState(event.target.value), 'aria-label': t('issues') },
        h('option', { value: 'opened' }, t('statusOpened')),
        h('option', { value: 'closed' }, t('statusClosed')),
        h('option', { value: 'all' }, t('allStatuses')),
      ),
      h('span', { className: 'gw-top-spacer' }),
      h(IconButton, { label: t('refresh'), onClick: list.reload }, h(I.refresh, { size: 15 })),
    ),
    h(ErrorNote, { error: list.error, onRetry: list.reload }),
    list.loading && !list.data ? h(Spinner) : null,
    list.data && list.data.items.length === 0 ? h(Empty, { title: t('noIssues') }) : null,
    list.data && list.data.items.length > 0
      ? h(
          'div',
          { className: 'gw-table' },
          list.data.items.map((issue: any) =>
            h(
              'button',
              { key: issue.id, type: 'button', className: 'gw-table-row', onClick: () => setSelected(issue.iid) },
              h('span', { className: 'gw-item-id gw-mono' }, `#${issue.iid}`),
              h('span', { className: 'gw-item-title' }, issue.title),
              h(LabelList, { labels: issue.labels }),
              h('span', { className: 'gw-row-time' }, relTime(issue.updated_at)),
              h(I.chevron, { size: 14 }),
            ),
          ),
        )
      : null,
  )
}
