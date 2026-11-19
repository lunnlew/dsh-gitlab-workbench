/**
 * A small GitLab REST v4 client over node http/https.
 *
 * Why not the built-in fetch: a self-managed instance is regularly served with
 * a corporate or self-signed certificate, and node's fetch offers no per-call
 * way to pass `ca` or to disable verification. The https module does, and it
 * also lets this plugin keep the token on one origin while following only
 * same-origin redirects.
 */
import http from 'node:http'
import https from 'node:https'

import type { InstanceStore } from './store.js'
import type { GitLabPage, Instance, Logger } from './types.js'

/** The largest JSON response this client accepts. */
const MAX_BODY = 8 * 1024 * 1024
/** The largest plain-text response (a job trace) this client accepts. */
const MAX_TEXT = 6 * 1024 * 1024
/** How many same-origin redirects are followed. */
const MAX_REDIRECTS = 3

/** A failure the routes report as-is. */
export class GitLabError extends Error {
  code: string
  status: number
  detail?: string

  constructor(message: string, options: { code?: string; status?: number; detail?: string } = {}) {
    super(message)
    this.name = 'GitLabError'
    this.code = options.code ?? 'gitlab_error'
    this.status = options.status ?? 502
    this.detail = options.detail
  }
}

export interface GitLabRequest {
  method?: string
  path: string
  query?: Record<string, unknown>
  body?: unknown
  text?: boolean
  timeoutMs?: number
  maxBody?: number
  /** A candidate token, used to validate one before storing it. */
  token?: string
}

export interface GitLabResponse {
  status: number
  headers: http.IncomingHttpHeaders
  data?: unknown
  text?: string
  error?: GitLabError
}

/** Turn a transport failure into a message that names the likely cause. */
function transportError(error: NodeJS.ErrnoException, instance: Instance): GitLabError {
  const code = String(error?.code ?? '')
  const host = new URL(instance.endpoint).host
  if (code === 'ECONNREFUSED') {
    return new GitLabError(`Cannot connect to ${host}: the connection was refused.`, {
      code: 'connection_refused',
      status: 502,
      detail: String(error?.message ?? ''),
    })
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new GitLabError(`Cannot resolve ${host}. Check the instance URL and DNS.`, {
      code: 'dns_error',
      status: 502,
      detail: String(error?.message ?? ''),
    })
  }
  if (
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    || code === 'SELF_SIGNED_CERT_IN_CHAIN'
    || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    || code === 'CERT_HAS_EXPIRED'
  ) {
    return new GitLabError(
      `${host} presented a certificate node does not trust. Add the corporate CA or disable verification for this instance in Settings.`,
      { code: 'tls_error', status: 502, detail: String(error?.message ?? '') },
    )
  }
  if (code === 'ETIMEDOUT' || /timeout/i.test(String(error?.message ?? ''))) {
    return new GitLabError(`The request to ${host} timed out.`, {
      code: 'timeout',
      status: 504,
      detail: String(error?.message ?? ''),
    })
  }
  return new GitLabError(`Cannot reach ${host}: ${String(error?.message ?? error)}`, {
    code: 'network_error',
    status: 502,
    detail: String(error?.message ?? ''),
  })
}

/** Read a GitLab error body into one line. */
function errorMessage(body: unknown, text: string): string {
  if (body && typeof body === 'object') {
    const source = body as Record<string, unknown>
    const message = source.message ?? source.error_description ?? source.error
    if (typeof message === 'string' && message.trim() !== '') return message.trim()
    if (Array.isArray(message)) return message.map(String).join('; ')
    if (message && typeof message === 'object') {
      return Object.entries(message as Record<string, unknown>)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
        .join('; ')
    }
  }
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim()
  return compact.length > 0 ? compact.slice(0, 300) : 'GitLab rejected the request.'
}

/** Map an HTTP status to a stable error code. */
function codeForStatus(status: number): string {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'gitlab_server_error'
  return 'request_failed'
}

export interface GitLabClient {
  request(instanceId: string, options: GitLabRequest): Promise<GitLabResponse>
  currentUser(instanceId: string, token?: string): Promise<Record<string, unknown>>
  version(instanceId: string): Promise<string>
}

/** Create the GitLab client. */
export function createGitLab({ store, logger: _logger }: { store: InstanceStore; logger?: Logger }): GitLabClient {
  async function request(instanceId: string, options: GitLabRequest): Promise<GitLabResponse> {
    const instance = store.get(instanceId)
    if (!instance) throw new GitLabError('Unknown instance.', { code: 'unknown_instance', status: 404 })
    const token = options.token ? { token: options.token } : await store.readToken(instanceId)
    if (!token?.token) {
      throw new GitLabError('No personal access token is stored for this instance.', {
        code: 'no_token',
        status: 401,
      })
    }

    const url = new URL(`${instance.endpoint}/api/v4${options.path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }

    const headers: Record<string, string | number> = {
      'PRIVATE-TOKEN': token.token,
      Accept: options.text ? 'text/plain, */*' : 'application/json',
      'User-Agent': 'dsh-gitlab-workbench/0.2',
    }
    let payload: Buffer | undefined
    if (options.body !== undefined) {
      payload = Buffer.from(JSON.stringify(options.body), 'utf8')
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(payload.length)
    }

    const timeoutMs = options.timeoutMs ?? 25000
    const maxBody = options.maxBody ?? (options.text ? MAX_TEXT : MAX_BODY)

    const send = (target: URL, redirects: number): Promise<GitLabResponse> => new Promise((resolve, reject) => {
      const transport = target.protocol === 'https:' ? https : http
      const requestOptions: https.RequestOptions = {
        method: options.method ?? 'GET',
        headers,
        timeout: timeoutMs,
      }
      if (target.protocol === 'https:') {
        requestOptions.rejectUnauthorized = instance.verifyTls !== false
        if (instance.caPem) requestOptions.ca = instance.caPem
      }
      const req = transport.request(target, requestOptions, (res) => {
        const status = res.statusCode ?? 0
        const location = res.headers.location
        if (status >= 300 && status < 400 && location && redirects < MAX_REDIRECTS) {
          res.resume()
          let next: URL
          try {
            next = new URL(location, target)
          } catch {
            reject(new GitLabError('GitLab returned an invalid redirect.', { code: 'bad_redirect', status: 502 }))
            return
          }
          if (next.origin !== new URL(instance.endpoint).origin) {
            reject(new GitLabError(
              `GitLab redirected to another origin (${next.origin}); refusing to forward the token.`,
              { code: 'cross_origin_redirect', status: 502 },
            ))
            return
          }
          resolve(send(next, redirects + 1))
          return
        }

        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBody) {
            res.destroy()
            reject(new GitLabError('The response is too large to display.', { code: 'response_too_large', status: 502 }))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const text = buffer.toString('utf8')
          const contentType = String(res.headers['content-type'] ?? '')
          const looksJson = contentType.includes('json') || /^\s*[[{]/.test(text)
          let data: unknown
          if (looksJson && (!options.text || status >= 400)) {
            try {
              data = text.trim() === '' ? null : JSON.parse(text)
            } catch {
              data = undefined
            }
          }
          if (status >= 200 && status < 300) {
            resolve({ status, headers: res.headers, data, text })
            return
          }
          resolve({
            status,
            headers: res.headers,
            data,
            text,
            error: new GitLabError(errorMessage(data, text), {
              code: codeForStatus(status),
              status,
              detail: typeof res.headers['retry-after'] === 'string' ? `Retry after ${res.headers['retry-after']}s` : undefined,
            }),
          })
        })
        res.on('error', (error) => reject(transportError(error as NodeJS.ErrnoException, instance)))
      })
      req.on('timeout', () => {
        req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
      })
      req.on('error', (error) => reject(transportError(error as NodeJS.ErrnoException, instance)))
      if (payload) req.write(payload)
      req.end()
    })

    let result: GitLabResponse
    try {
      result = await send(url, 0)
    } catch (error) {
      if (error instanceof GitLabError) throw error
      throw transportError(error as NodeJS.ErrnoException, instance)
    }
    if (result.error) throw result.error
    return result
  }

  async function currentUser(instanceId: string, token?: string): Promise<Record<string, unknown>> {
    const result = await request(instanceId, { path: '/user', ...(token ? { token } : {}) })
    return (result.data as Record<string, unknown>) ?? {}
  }

  async function version(instanceId: string): Promise<string> {
    try {
      const result = await request(instanceId, { path: '/version', timeoutMs: 10000 })
      if (result.data && typeof result.data === 'object') {
        const value = (result.data as Record<string, unknown>).version ?? result.data
        return typeof value === 'string' ? value : ''
      }
    } catch {
      // A version the proxy does not expose does not fail the connection.
    }
    return ''
  }

  return { request, currentUser, version }
}

/** Turn a paginated response into one object the client understands. */
export function pageOf<T = unknown>(result: GitLabResponse): GitLabPage<T> {
  const header = (name: string): string | undefined => {
    const value = result.headers?.[name]
    if (Array.isArray(value)) return value[0]
    return typeof value === 'string' ? value : undefined
  }
  const number = (name: string): number | null => {
    const raw = header(name)
    const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return {
    items: Array.isArray(result.data) ? (result.data as T[]) : [],
    total: number('x-total'),
    page: number('x-page') ?? 1,
    nextPage: number('x-next-page'),
  }
}
