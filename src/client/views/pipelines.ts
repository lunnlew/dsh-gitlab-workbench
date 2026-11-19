/**
 * The pipelines tab: a list on the left, the selected pipeline's stages, jobs
 * and the tail of a job log on the right.
 */
import { createElement as h, useEffect, useMemo, useState } from 'react'

import { api } from '../api'
import { I } from '../icons'
import { t } from '../i18n'
import { fmtDuration, isActivePipelineStatus, pipelineDuration, relTime, shortSha, statusText, useAsync, usePolling } from '../util'
import { Button, Empty, ErrorNote, IconButton, MetaGrid, Spinner, Status } from '../ui'

interface Stage {
  stage: string
  items: any[]
  tone: string
  meta: string
}

/** Group jobs by stage, keeping GitLab's order. */
function stagesOf(jobs: any[]): Stage[] {
  const order: string[] = []
  const map = new Map<string, any[]>()
  for (const job of jobs) {
    const stage = job.stage || 'default'
    if (!map.has(stage)) {
      map.set(stage, [])
      order.push(stage)
    }
    map.get(stage)!.push(job)
  }
  return order.map((stage) => {
    const items = map.get(stage)!
    const failed = items.filter((job) => job.status === 'failed').length
    const running = items.filter((job) => ['running', 'pending', 'preparing'].includes(job.status)).length
    const success = items.filter((job) => job.status === 'success').length
    const skipped = items.filter((job) => ['skipped', 'canceled', 'manual'].includes(job.status)).length
    let tone = 'idle'
    let meta = `${skipped} ${statusText('skipped')}`
    if (failed > 0) {
      tone = 'error'
      meta = `${failed} ${statusText('failed')} / ${success} ${statusText('success')}`
    } else if (running > 0) {
      tone = 'brand'
      meta = `${running} ${statusText('running')}`
    } else if (success > 0) {
      tone = 'success'
      meta = `${success} ${statusText('success')}`
    }
    return { stage, items, tone, meta }
  })
}

function JobLog({ instanceId, projectPath, job, onClose }: { instanceId: string; projectPath: string; job: any; onClose: () => void }) {
  const { data, error, loading, reload } = useAsync(
    () => api('job-trace', { query: { id: instanceId, path: projectPath, jobId: job.id } }),
    [instanceId, projectPath, job.id],
  )
  const download = () => {
    if (!data) return
    const blob = new Blob([data.content ?? ''], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `job-${job.id}-${job.name}.log`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return h(
    'section',
    { className: 'gw-log' },
    h(
      'div',
      { className: 'gw-log-head' },
      h(I.terminal, { size: 13 }),
      h('span', { className: 'gw-mono' }, `${job.name} · #${job.id}`),
      h('span', { className: 'gw-top-spacer' }),
      h(Button, { kind: 'ghost', small: true, onClick: download, disabled: !data }, t('download')),
      job.web_url && job.web_url !== '#'
        ? h(
            'a',
            { className: 'gw-btn is-ghost is-sm', href: job.web_url, target: '_blank', rel: 'noreferrer noopener' },
            t('openInGitLab'),
            h(I.external, { size: 12 }),
          )
        : null,
      h(Button, { kind: 'ghost', small: true, onClick: onClose }, t('hideLog')),
    ),
    h(ErrorNote, { error, onRetry: reload }),
    loading ? h(Spinner) : null,
    data
      ? h(
          'div',
          { className: 'gw-log-fill' },
          data.truncated ? h('div', { className: 'gw-log-note' }, t('traceTruncated')) : null,
          h('pre', { className: 'gw-log-body' }, data.content),
        )
      : null,
  )
}

export function PipelineDetail({ instanceId, projectPath, pipelineId }: { instanceId: string; projectPath: string; pipelineId: number }) {
  const [traceJob, setTraceJob] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState<any>(null)

  // A new pipeline is a new context: close the previous job log instead of
  // leaving another pipeline's output on screen.
  useEffect(() => {
    setTraceJob(null)
    setActionError(null)
  }, [pipelineId])
  const { data, error, loading, reload } = useAsync(
    () => api('pipeline', { query: { id: instanceId, path: projectPath, pipelineId } }),
    [instanceId, projectPath, pipelineId],
  )
  const pipeline = data?.pipeline
  const jobs = data?.jobs ?? []
  const stages = useMemo(() => stagesOf(jobs), [jobs])

  usePolling(reload, isActivePipelineStatus(pipeline?.status), 5000)

  const act = async (kind: string, job?: any) => {
    setBusy(kind + (job ? job.id : pipelineId))
    setActionError(null)
    try {
      if (kind === 'retry-pipeline') await api('pipeline/retry', { method: 'POST', query: { id: instanceId }, body: { path: projectPath, pipelineId } })
      if (kind === 'cancel-pipeline') await api('pipeline/cancel', { method: 'POST', query: { id: instanceId }, body: { path: projectPath, pipelineId } })
      if (kind === 'retry-job') await api('job/retry', { method: 'POST', query: { id: instanceId }, body: { path: projectPath, jobId: job.id } })
      if (kind === 'cancel-job') await api('job/cancel', { method: 'POST', query: { id: instanceId }, body: { path: projectPath, jobId: job.id } })
      if (kind === 'play-job') await api('job/play', { method: 'POST', query: { id: instanceId }, body: { path: projectPath, jobId: job.id } })
      reload()
    } catch (failure) {
      setActionError(failure)
    } finally {
      setBusy('')
    }
  }

  return h(
    'div',
    { className: 'gw-detail-pane' },
    h(
      'div',
      { className: 'gw-detail-head' },
      h('div', { className: 'gw-detail-title' }, h('h2', null, `#${pipelineId}`), pipeline ? h(Status, { status: pipeline.status }) : null),
      h(
        'div',
        { className: 'gw-detail-actions' },
        pipeline && ['failed', 'success', 'canceled'].includes(pipeline.status)
          ? h(Button, { kind: 'ghost', small: true, onClick: () => act('retry-pipeline'), disabled: Boolean(busy) }, h(I.refresh, { size: 13 }), t('retryPipeline'))
          : null,
        pipeline && ['running', 'pending'].includes(pipeline.status)
          ? h(Button, { kind: 'ghost', small: true, onClick: () => act('cancel-pipeline'), disabled: Boolean(busy) }, h(I.stop, { size: 13 }), t('cancelPipeline'))
          : null,
        pipeline?.web_url
          ? h('a', { className: 'gw-btn is-ghost is-sm', href: pipeline.web_url, target: '_blank', rel: 'noreferrer noopener' }, t('openInGitLab'), h(I.external, { size: 12 }))
          : null,
      ),
    ),
    h(ErrorNote, { error, onRetry: reload }),
    actionError ? h(ErrorNote, { error: actionError }) : null,
    loading && !pipeline ? h(Spinner) : null,
    pipeline
      ? h(MetaGrid, {
          items: [
            [t('commit'), h('span', { className: 'gw-mono' }, shortSha(pipeline.sha))],
            [t('branch'), h('span', { className: 'gw-mono' }, pipeline.ref || '—')],
            [t('source'), pipeline.source || '—'],
            [t('created'), relTime(pipeline.created_at)],
            [t('duration'), pipelineDuration(pipeline)],
          ],
        })
      : null,
    stages.length > 0
      ? h(
          'div',
          { className: 'gw-timeline', 'aria-label': t('stage') },
          stages.map((group, index) => [
            h(
              'div',
              { key: group.stage, className: `gw-stage is-${group.tone}` },
              h('span', { className: 'gw-stage-dot' }),
              h('span', { className: 'gw-stage-name' }, group.stage),
              h('span', { className: 'gw-stage-meta' }, group.meta),
            ),
            index < stages.length - 1
              ? h('span', { key: `${group.stage}-line`, className: `gw-stage-line${group.tone === 'success' ? ' is-done' : ''}` })
              : null,
          ]),
        )
      : null,
    jobs.length > 0
      ? h(
          'div',
          { className: 'gw-jobs' },
          jobs.map((job: any) =>
            h(
              'div',
              { key: job.id, className: 'gw-job' },
              h(Status, { status: job.status }),
              h('span', { className: 'gw-job-name' }, job.name),
              h('span', { className: 'gw-job-stage' }, `${job.stage || 'default'} · #${job.id}`),
              h('span', { className: 'gw-job-dur' }, fmtDuration(job.duration)),
              h(
                'span',
                { className: 'gw-job-actions' },
                h(Button, { kind: 'ghost', small: true, onClick: () => setTraceJob(traceJob?.id === job.id ? null : job) }, h(I.terminal, { size: 12 }), t('log')),
                ['failed', 'canceled', 'success', 'skipped'].includes(job.status)
                  ? h(Button, { kind: 'ghost', small: true, onClick: () => act('retry-job', job), disabled: Boolean(busy) }, h(I.refresh, { size: 12 }), t('retryJob'))
                  : null,
                ['running', 'pending'].includes(job.status)
                  ? h(Button, { kind: 'ghost', small: true, onClick: () => act('cancel-job', job), disabled: Boolean(busy) }, h(I.stop, { size: 12 }), t('cancelJob'))
                  : null,
                job.status === 'manual'
                  ? h(Button, { kind: 'ghost', small: true, onClick: () => act('play-job', job), disabled: Boolean(busy) }, h(I.play, { size: 12 }), t('playJob'))
                  : null,
                job.web_url && job.web_url !== '#'
                  ? h(
                      'a',
                      { className: 'gw-btn is-ghost is-sm', href: job.web_url, target: '_blank', rel: 'noreferrer noopener', title: t('openInGitLab') },
                      h(I.external, { size: 12 }),
                    )
                  : null,
              ),
            ),
          ),
        )
      : null,
    traceJob ? h(JobLog, { instanceId, projectPath, job: traceJob, onClose: () => setTraceJob(null) }) : null,
  )
}

export function PipelinesTab({ instanceId, projectPath, refName }: { instanceId: string; projectPath: string; refName: string }) {
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [allRefs, setAllRefs] = useState(false)

  useEffect(() => {
    setAllRefs(false)
  }, [refName])

  const list = useAsync(
    () => api('pipelines', { query: { id: instanceId, path: projectPath, status, ref: allRefs ? '' : refName } }),
    [instanceId, projectPath, status, refName, allRefs],
  )

  usePolling(
    list.reload,
    (list.data?.items ?? []).some((pipeline: any) => isActivePipelineStatus(pipeline.status)),
    8000,
  )

  useEffect(() => {
    const items = list.data?.items ?? []
    if (items.length === 0) {
      if (selected !== null) setSelected(null)
      return
    }
    if (!selected || !items.some((pipeline: any) => pipeline.id === selected)) setSelected(items[0].id)
  }, [list.data, selected])

  const filters = [
    { id: '', label: t('allStatuses') },
    { id: 'failed', label: t('statusFailed') },
    { id: 'running', label: t('statusRunning') },
  ]

  return h(
    'div',
    { className: 'gw-split' },
    h(
      'div',
      { className: 'gw-list-pane' },
      h(
        'div',
        { className: 'gw-toolbar' },
        h(
          'div',
          { className: 'gw-seg', role: 'tablist', 'aria-label': t('pipeline') },
          filters.map((filter) =>
            h(
              'button',
              {
                key: filter.id || 'all',
                type: 'button',
                role: 'tab',
                'aria-selected': status === filter.id,
                className: status === filter.id ? 'is-active' : '',
                onClick: () => setStatus(filter.id),
              },
              filter.label,
            ),
          ),
        ),
        h('span', { className: 'gw-top-spacer' }),
        h(
          'button',
          {
            type: 'button',
            className: `gw-chip${allRefs ? ' is-active' : ''}`,
            onClick: () => setAllRefs((current) => !current),
            title: allRefs ? t('allBranches') : refName || t('allBranches'),
          },
          allRefs ? t('allBranches') : refName || t('allBranches'),
        ),
        h(IconButton, { label: t('refresh'), onClick: list.reload }, h(I.refresh, { size: 15 })),
      ),
      h(ErrorNote, { error: list.error, onRetry: list.reload }),
      h(
        'div',
        { className: 'gw-scroll-y' },
        list.loading && !list.data ? h(Spinner) : null,
        list.data && list.data.items.length === 0
          ? h(Empty, {
              title: t('noPipelines'),
              hint: refName && !allRefs ? t('noPipelinesBranch', { ref: refName }) : t('noPipelinesHint'),
              action:
                refName && !allRefs
                  ? h(Button, { kind: 'ghost', onClick: () => setAllRefs(true) }, t('allBranches'))
                  : null,
            })
          : null,
        (list.data?.items ?? []).map((pipeline: any) =>
          h(
            'button',
            {
              key: pipeline.id,
              type: 'button',
              className: `gw-pipe-row${selected === pipeline.id ? ' is-active' : ''}`,
              onClick: () => setSelected(pipeline.id),
            },
            h(
              'span',
              { className: 'gw-pipe-row-top' },
              h(Status, { status: pipeline.status }),
              h('span', { className: 'gw-pipe-id' }, `#${pipeline.id}`),
              h('span', { className: 'gw-row-time' }, relTime(pipeline.created_at)),
            ),
            h(
              'span',
              { className: 'gw-pipe-row-bottom' },
              h(I.branch, { size: 11 }),
              h('span', null, pipeline.ref),
              h('span', { className: 'gw-mono' }, shortSha(pipeline.sha)),
              h('span', { className: 'gw-pipe-duration' }, pipelineDuration(pipeline)),
            ),
          ),
        ),
      ),
    ),
    selected
      ? h(PipelineDetail, { key: selected, instanceId, projectPath, pipelineId: selected })
      : h('div', { className: 'gw-detail-pane' }, h(Empty, { title: t('noSelection') })),
  )
}
