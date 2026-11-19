/**
 * The browser half's channel to the host half.
 *
 * Both run on the same loopback origin, so calls are ordinary same-origin
 * requests under the route prefix the host registers. The token never crosses
 * this boundary.
 */
import { t } from './i18n'

export const API_ROOT = '/gitlab-workbench/api/'

export type ApiError = Error & { code?: string; status?: number; detail?: string }

export interface ApiOptions {
  method?: string
  query?: Record<string, unknown>
  body?: unknown
}

/** Call one host route and unwrap its `{ ok, data }` envelope. */
export async function api<T = any>(action: string, options: ApiOptions = {}): Promise<T> {
  const url = new URL(API_ROOT + action, window.location.origin)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    throw Object.assign(new Error(t('errorNetwork')), { code: 'network_error', cause: error })
  }
  let payload: any
  try {
    payload = await response.json()
  } catch {
    throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'bad_response', status: response.status })
  }
  if (!payload || payload.ok !== true) {
    const reason = payload && payload.error ? payload.error : {}
    throw Object.assign(new Error(reason.message || `HTTP ${response.status}`), {
      code: reason.code,
      status: reason.status ?? response.status,
      detail: reason.detail,
    })
  }
  return payload.data as T
}
