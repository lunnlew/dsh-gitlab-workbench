/**
 * Merge requests: the project's list and one request's details.
 */
import { createElement as h, useState } from 'react'

import { api } from '../api'
import { I } from '../icons'
import { t } from '../i18n'
import { relTime, useAsync } from '../util'
import { Button, Empty, ErrorNote, IconButton, LabelList, Spinner, Status } from '../ui'

function MergeRequestDetail({ instanceId, projectPath, iid, onBack }: { instanceId: string; projectPath: string; iid: number; onBack: () => void }) {
  const { data, error, loading, reload } = useAsync(
    () => api('merge-request', { query: { id: instanceId, path: projectPath, iid } }),
    [instanceId, projectPath, iid],
  )
  const pipeline = data?.head_pipeline || data?.pipeline
  return h(
    'div',
    { className: 'gw-detail' },
    h(
      'div',
      { className: 'gw-detail-head' },
      h(IconButton, { label: t('back'), onClick: onBack }, h(I.chevron, { size: 14, style: { transform: 'rotate(180deg)' } })),
      h('span', { className: 'gw-detail-kicker gw-mono' }, `!${data?.iid ?? iid}`),
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
            h('span', { className: 'gw-mono' }, `${data.source_branch} → ${data.target_branch}`),
            h('span', null, relTime(data.updated_at)),
            data.changes_count ? h('span', null, `${t('changes')} ${data.changes_count}`) : null,
          ),
          h(LabelList, { labels: data.labels }),
          pipeline
            ? h('div', { className: 'gw-inline-pipeline' }, h('span', null, t('pipelineOfMR')), h(Status, { status: pipeline.status }), h('span', { className: 'gw-muted gw-mono' }, `#${pipeline.id}`))
            : null,
          h('h3', { className: 'gw-subhead' }, t('description')),
          h('pre', { className: 'gw-description' }, data.description || t('noDescription')),
        )
      : null,
  )
}

export function MergeRequestsTab({ instanceId, projectPath }: { instanceId: string; projectPath: string }) {
  const [state, setState] = useState('opened')
  const [selected, setSelected] = useState<number | null>(null)
  const list = useAsync(
    () => api('merge-requests', { query: { id: instanceId, path: projectPath, state } }),
    [instanceId, projectPath, state],
  )

  if (selected) {
    return h(MergeRequestDetail, { instanceId, projectPath, iid: selected, onBack: () => setSelected(null) })
  }

  return h(
    'div',
    { className: 'gw-content' },
    h(
      'div',
      { className: 'gw-toolbar' },
      h(
        'select',
        { className: 'gw-input gw-select', value: state, onChange: (event: any) => setState(event.target.value), 'aria-label': t('mergeRequests') },
        h('option', { value: 'opened' }, t('statusOpened')),
        h('option', { value: 'merged' }, t('statusMerged')),
        h('option', { value: 'closed' }, t('statusClosed')),
        h('option', { value: 'all' }, t('allStatuses')),
      ),
      h('span', { className: 'gw-top-spacer' }),
      h(IconButton, { label: t('refresh'), onClick: list.reload }, h(I.refresh, { size: 15 })),
    ),
    h(ErrorNote, { error: list.error, onRetry: list.reload }),
    list.loading && !list.data ? h(Spinner) : null,
    list.data && list.data.items.length === 0 ? h(Empty, { title: t('noMergeRequests') }) : null,
    list.data && list.data.items.length > 0
      ? h(
          'div',
          { className: 'gw-table' },
          list.data.items.map((mr: any) =>
            h(
              'button',
              { key: mr.id, type: 'button', className: 'gw-table-row', onClick: () => setSelected(mr.iid) },
              h('span', { className: 'gw-item-id gw-mono' }, `!${mr.iid}`),
              h('span', { className: 'gw-item-title' }, mr.title),
              h(LabelList, { labels: mr.labels }),
              mr.head_pipeline || mr.pipeline ? h(Status, { status: (mr.head_pipeline || mr.pipeline).status }) : null,
              h('span', { className: 'gw-row-time' }, relTime(mr.updated_at)),
              h(I.chevron, { size: 14 }),
            ),
          ),
        )
      : null,
  )
}
