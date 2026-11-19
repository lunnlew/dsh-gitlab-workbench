/**
 * Formatting, status vocabulary and the small data-loading hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { getLanguage, t } from './i18n'

/** Format an ISO date as a relative time. */
export function relTime(value: string | undefined | null): string {
  if (!value) return '—'
  const then = Date.parse(value)
  if (!Number.isFinite(then)) return '—'
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return getLanguage() === 'zh' ? '刚刚' : 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return getLanguage() === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return getLanguage() === 'zh' ? `${hours} 小时前` : `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return getLanguage() === 'zh' ? `${days} 天前` : `${days}d ago`
  return new Date(then).toLocaleDateString()
}

/** Format a duration in seconds. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  if (minutes < 60) return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes - hours * 60}m`
}

/** How long a finished pipeline took. */
export function pipelineDuration(pipeline: any): string {
  if (typeof pipeline?.duration === 'number') return fmtDuration(pipeline.duration)
  if (!pipeline?.created_at || !pipeline?.updated_at) return '—'
  if (!['success', 'failed', 'canceled', 'skipped'].includes(pipeline.status)) return '—'
  return fmtDuration((Date.parse(pipeline.updated_at) - Date.parse(pipeline.created_at)) / 1000)
}

const TONES: Record<string, string> = {
  success: 'success',
  failed: 'error',
  canceled: 'idle',
  skipped: 'idle',
  manual: 'warn',
  running: 'brand',
  pending: 'warn',
  created: 'warn',
  preparing: 'warn',
  waiting_for_resource: 'warn',
  scheduled: 'warn',
  opened: 'brand',
  merged: 'success',
  closed: 'idle',
}

const STATUS_TEXT: Record<string, { zh: string; en: string }> = {
  success: { zh: '成功', en: 'Success' },
  failed: { zh: '失败', en: 'Failed' },
  running: { zh: '运行中', en: 'Running' },
  pending: { zh: '等待中', en: 'Pending' },
  canceled: { zh: '已取消', en: 'Canceled' },
  skipped: { zh: '跳过', en: 'Skipped' },
  manual: { zh: '手动', en: 'Manual' },
  created: { zh: '已创建', en: 'Created' },
  preparing: { zh: '准备中', en: 'Preparing' },
  waiting_for_resource: { zh: '等待资源', en: 'Waiting' },
  scheduled: { zh: '已计划', en: 'Scheduled' },
  opened: { zh: '打开', en: 'Open' },
  closed: { zh: '已关闭', en: 'Closed' },
  merged: { zh: '已合并', en: 'Merged' },
  locked: { zh: '已锁定', en: 'Locked' },
}

/** Read a status label. */
export function statusText(status: string): string {
  const entry = STATUS_TEXT[status]
  if (!entry) return status || '—'
  return getLanguage() === 'zh' ? entry.zh : entry.en
}

/** Read a status tone. */
export function statusTone(status: string): string {
  return TONES[status] ?? 'idle'
}

/** Shorten a commit SHA. */
export function shortSha(sha: unknown): string {
  return typeof sha === 'string' ? sha.slice(0, 8) : '—'
}

/**
 * Turn a failure into the most specific message the dictionary has.
 */
export function errorText(error: any): string {
  if (!error) return ''
  if (getLanguage() === 'zh') {
    if (error.code === 'no_token') return t('errorNoToken')
    if (error.code === 'unauthorized' || error.code === 'invalid_token') return t('errorUnauthorized')
    if (error.code === 'forbidden') return t('errorForbidden')
    if (error.code === 'not_found') return t('errorNotFound')
    if (error.code === 'rate_limited') return t('errorRateLimited')
    if (error.code === 'tls_error') return t('errorTls')
    if (['network_error', 'connection_refused', 'dns_error', 'timeout'].includes(error.code)) return t('errorNetwork')
  }
  return error.message || t('errorGeneric')
}

export interface AsyncState<T> {
  data: T | null
  error: any
  loading: boolean
  reload: () => void
}

/** Pipeline statuses that change on their own and are worth polling. */
const ACTIVE_PIPELINE_STATUSES = new Set([
  'created',
  'waiting_for_resource',
  'preparing',
  'pending',
  'running',
  'scheduled',
])

export function isActivePipelineStatus(status?: string | null): boolean {
  return Boolean(status && ACTIVE_PIPELINE_STATUSES.has(status))
}

/** Re-run a loader on an interval while `active` is true and the page is visible. */
export function usePolling(reload: () => void, active: boolean, intervalMs: number): void {
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      reload()
    }, intervalMs)
    return () => clearInterval(timer)
  }, [active, reload, intervalMs])
}

/** Run one asynchronous read, reloading when its inputs change. */
export function useAsync<T = any>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: any; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  })
  const [nonce, setNonce] = useState(0)
  const seq = useRef(0)
  useEffect(() => {
    const current = ++seq.current
    setState((previous) => ({ data: previous.data, error: null, loading: true }))
    Promise.resolve()
      .then(load)
      .then((data) => {
        if (seq.current === current) setState({ data, error: null, loading: false })
      })
      .catch((error) => {
        if (seq.current === current) setState({ data: null, error, loading: false })
      })
    return () => {
      seq.current += 1
    }
  }, [...deps, nonce])
  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { ...state, reload }
}

export interface UiSelection {
  instanceId: string
  project: string
}

/** Read the persisted UI state. */
export function readUiState(): UiSelection {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('dsh-gitlab-workbench:ui') || '{}')
    return {
      instanceId: typeof parsed.instanceId === 'string' ? parsed.instanceId : '',
      project: typeof parsed.project === 'string' ? parsed.project : '',
    }
  } catch {
    return { instanceId: '', project: '' }
  }
}

/** Persist the UI state. */
export function writeUiState(state: UiSelection): void {
  try {
    window.localStorage.setItem('dsh-gitlab-workbench:ui', JSON.stringify(state))
  } catch {
    // A private window without storage simply forgets the selection.
  }
}
