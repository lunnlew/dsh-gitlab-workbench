/**
 * The host routes of the workbench.
 *
 * Every browser call goes through one prefix route and the same admission check
 * the rest of the Harness uses, so the route table is the only surface the web
 * page can reach. The token never travels back over it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { GitLabError, pageOf, type GitLabClient } from './gitlab.js'
import type { InstanceStore } from './store.js'
import type { InstanceView, InstanceStatus, PluginContext } from './types.js'

/** The prefix of every route this plugin serves. */
export const ROUTE_PREFIX = '/gitlab-workbench/api/'

/** The largest request body accepted. */
const MAX_BODY = 1024 * 1024

/** How much of a job trace is returned. */
const TRACE_TAIL = 200000

/** The actions that need an instance id. */
const PROJECT_ACTIONS = new Set([
  'projects',
  'project',
  'branches',
  'tags',
  'commits',
  'tree',
  'file',
  'pipelines',
  'pipeline',
  'job-trace',
  'pipeline/retry',
  'pipeline/cancel',
  'job/retry',
  'job/cancel',
  'job/play',
  'merge-requests',
  'merge-request',
  'issues',
  'issue',
])

/** File extensions the viewer treats as binary. */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff', 'avif',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'webm', 'mov', 'avi',
  'so', 'dll', 'exe', 'bin', 'class', 'pyc', 'wasm', 'db', 'sqlite',
])

type JsonRecord = Record<string, unknown>

/** A failure the route table reports with its own status and code. */
export interface RouteError extends Error {
  code?: string
  status?: number
  detail?: string
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function ok(res: ServerResponse, data: unknown): void {
  json(res, 200, { ok: true, data })
}

function fail(res: ServerResponse, error: RouteError): void {
  const status = Number.isInteger(error?.status) ? error.status! : 500
  json(res, status, {
    ok: false,
    error: {
      code: error?.code ?? 'internal_error',
      message: String(error?.message ?? error),
      ...(error?.detail ? { detail: String(error.detail) } : {}),
    },
  })
}

function readJson(req: IncomingMessage): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('The request body is too large.'), { status: 413, code: 'body_too_large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonRecord) : {})
      } catch {
        reject(Object.assign(new Error('The request body is not valid JSON.'), { status: 400, code: 'bad_json' }))
      }
    })
    req.on('error', (error) => reject(error))
  })
}

/** Strip ANSI escape sequences so a trace renders as plain text. */
function plainTrace(text: string): string {
  return String(text)
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
}

/** Report whether a file should be opened in the binary branch. */
function looksBinary(filePath: string, text: string): boolean {
  const extension = filePath.includes('.') ? filePath.split('.').pop()!.toLowerCase() : ''
  if (BINARY_EXTENSIONS.has(extension)) return true
  return text.includes('\u0000')
}

export interface RoutesDeps {
  ctx: PluginContext
  store: InstanceStore
  gitlab: GitLabClient
  version: string
}

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** Build the route handler. */
export function createRoutes({ ctx, store, gitlab, version }: RoutesDeps): RouteHandler {
  /** Apply the host's own admission check to one request. */
  function admit(req: IncomingMessage, res: ServerResponse): boolean {
    // The connection service is optional and is not part of this plugin's
    // `inject`; read it through the registry so a profile without it falls
    // back to the loopback check instead of throwing.
    let connection: PluginContext['connection']
    try {
      connection = ctx.get?.('connection') as PluginContext['connection']
    } catch {
      connection = undefined
    }
    if (connection && typeof connection.requestRejection === 'function') {
      let rejected: number | undefined
      try {
        rejected = connection.requestRejection(req)
      } catch {
        rejected = 403
      }
      if (rejected) {
        json(res, rejected, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return false
      }
      return true
    }
    const remote = String(req.socket?.remoteAddress ?? '')
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      json(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return false
    }
    return true
  }

  /** Describe one instance for the browser, without its token. */
  async function describeInstance(instance: ReturnType<InstanceStore['get']> & object): Promise<InstanceView> {
    const token = await store.readToken(instance.id)
    const status: InstanceStatus = store.getStatus(instance.id) ?? { ok: null }
    return {
      id: instance.id,
      label: instance.label,
      endpoint: instance.endpoint,
      verifyTls: instance.verifyTls !== false,
      hasCaPem: typeof instance.caPem === 'string' && instance.caPem !== '',
      hasToken: Boolean(token?.token),
      tokenUsername: token?.username ?? '',
      status,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    }
  }

  /** Check one instance against GitLab and remember the result. */
  async function testInstance(instanceId: string): Promise<InstanceStatus> {
    const instance = store.get(instanceId)
    if (!instance) throw Object.assign(new Error('Unknown instance.'), { code: 'unknown_instance', status: 404 })
    try {
      const user = await gitlab.currentUser(instanceId)
      const gitlabVersion = await gitlab.version(instanceId)
      const status: InstanceStatus = {
        ok: true,
        user: {
          username: String(user.username ?? ''),
          name: String(user.name ?? ''),
          avatarUrl: String(user.avatar_url ?? ''),
          webUrl: String(user.web_url ?? ''),
        },
        version: gitlabVersion,
      }
      store.setStatus(instanceId, status)
      return { ...status, checkedAt: new Date().toISOString() }
    } catch (error) {
      const failure = error as RouteError
      const status: InstanceStatus = {
        ok: false,
        error: {
          code: failure?.code ?? 'connection_failed',
          message: String(failure?.message ?? error),
          status: failure?.status ?? 502,
        },
      }
      store.setStatus(instanceId, status)
      return { ...status, checkedAt: new Date().toISOString() }
    }
  }

  function required(body: JsonRecord | undefined, name: string): string {
    const value = body?.[name]
    const text = typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : ''
    if (text === '') {
      throw Object.assign(new Error(`The "${name}" field is required.`), { status: 400, code: 'bad_request' })
    }
    return text
  }

  function requiredQuery(query: URLSearchParams, name: string): string {
    const value = query.get(name)
    if (!value || value.trim() === '') {
      throw Object.assign(new Error(`The "${name}" parameter is required.`), { status: 400, code: 'bad_request' })
    }
    return value
  }

  function projectSegment(project: string): string {
    return encodeURIComponent(project)
  }

  async function dispatch(action: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const query = url.searchParams
    const method = req.method ?? 'GET'

    if (action === 'ping') {
      ok(res, { version })
      return
    }

    if (action === 'instances' && method === 'GET') {
      const items = await Promise.all(store.list().map((instance) => describeInstance(instance)))
      ok(res, { items })
      return
    }

    if (action === 'instances/add' && method === 'POST') {
      const body = await readJson(req)
      const instance = store.add({
        label: typeof body.label === 'string' ? body.label : '',
        endpoint: required(body, 'endpoint'),
        verifyTls: body.verifyTls !== false,
        caPem: typeof body.caPem === 'string' ? body.caPem : '',
      })
      ok(res, await describeInstance(instance))
      return
    }

    if (action === 'instances/update' && method === 'POST') {
      const body = await readJson(req)
      const id = required(body, 'id')
      const patch: { label?: string; endpoint?: string; verifyTls?: boolean; caPem?: string | null } = {}
      if (typeof body.label === 'string') patch.label = body.label
      if (typeof body.endpoint === 'string') patch.endpoint = body.endpoint
      if (typeof body.verifyTls === 'boolean') patch.verifyTls = body.verifyTls
      if (body.caPem === null || typeof body.caPem === 'string') patch.caPem = body.caPem
      const instance = await store.update(id, patch)
      ok(res, await describeInstance(instance))
      return
    }

    if (action === 'instances/remove' && method === 'POST') {
      const body = await readJson(req)
      const id = required(body, 'id')
      ok(res, { removed: await store.remove(id) })
      return
    }

    if (action === 'instances/token' && method === 'POST') {
      const body = await readJson(req)
      const id = required(body, 'id')
      const token = required(body, 'token')
      const instance = store.get(id)
      if (!instance) throw Object.assign(new Error('Unknown instance.'), { code: 'unknown_instance', status: 404 })
      let user: Record<string, unknown>
      try {
        user = await gitlab.currentUser(id, token)
      } catch (error) {
        const failure = error as RouteError
        if (failure?.code === 'unauthorized') {
          throw Object.assign(new Error('GitLab rejected this token. Check its scopes (read_api, or api) and expiry.'), {
            code: 'invalid_token',
            status: 401,
          })
        }
        throw error
      }
      await store.writeToken(id, {
        token,
        username: String(user.username ?? ''),
        name: String(user.name ?? ''),
        avatarUrl: String(user.avatar_url ?? ''),
        webUrl: String(user.web_url ?? ''),
        updatedAt: new Date().toISOString(),
      })
      ok(res, { status: await testInstance(id) })
      return
    }

    if (action === 'instances/test' && method === 'POST') {
      const body = await readJson(req)
      ok(res, await testInstance(required(body, 'id')))
      return
    }

    if (!PROJECT_ACTIONS.has(action)) {
      throw Object.assign(new Error(`Unknown action "${action}".`), { status: 404, code: 'unknown_action' })
    }
    const instanceId = requiredQuery(query, 'id')
    if (!store.get(instanceId)) {
      throw Object.assign(new Error('Unknown instance.'), { code: 'unknown_instance', status: 404 })
    }

    if (action === 'projects' && method === 'GET') {
      const result = await gitlab.request(instanceId, {
        path: '/projects',
        query: {
          membership: true,
          simple: false,
          per_page: 40,
          order_by: 'last_activity_at',
          sort: 'desc',
          page: query.get('page') ?? '1',
          search: query.get('search') ?? '',
        },
      })
      ok(res, pageOf(result))
      return
    }

    if (action === 'project' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const result = await gitlab.request(instanceId, { path: `/projects/${projectSegment(project)}` })
      const data = (result.data as JsonRecord) ?? {}
      let openMergeRequests: number | null = null
      try {
        const count = await gitlab.request(instanceId, {
          path: `/projects/${projectSegment(project)}/merge_requests`,
          query: { state: 'opened', per_page: 1 },
        })
        const parsed = Number.parseInt(String(count.headers?.['x-total'] ?? ''), 10)
        openMergeRequests = Number.isFinite(parsed) ? parsed : null
      } catch {
        openMergeRequests = null
      }
      ok(res, { project: data, openMergeRequests })
      return
    }

    if (action === 'branches' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/repository/branches`,
        query: { per_page: 100, page: query.get('page') ?? '1' },
      })
      ok(res, pageOf(result))
      return
    }

    if (action === 'tags' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/repository/tags`,
        query: { per_page: 100, page: query.get('page') ?? '1' },
      })
      ok(res, pageOf(result))
      return
    }

    if (action === 'commits' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/repository/commits`,
        query: { per_page: 30, page: query.get('page') ?? '1', ref_name: query.get('ref') ?? '' },
      })
      ok(res, pageOf(result))
      return
    }

    if (action === 'tree' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/repository/tree`,
        query: {
          per_page: 100,
          page: query.get('page') ?? '1',
          path: query.get('dir') ?? '',
          ref: query.get('ref') ?? '',
        },
      })
      ok(res, pageOf(result))
      return
    }

    if (action === 'file' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const filePath = requiredQuery(query, 'filePath')
      const ref = query.get('ref') ?? ''
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/repository/files/${encodeURIComponent(filePath)}/raw`,
        query: { ref },
        text: true,
      })
      const text = String(result.text ?? '')
      const binary = looksBinary(filePath, text)
      const limit = 300000
      ok(res, {
        filePath,
        ref,
        binary,
        size: Buffer.byteLength(text, 'utf8'),
        truncated: text.length > limit,
        content: binary ? '' : text.slice(0, limit),
      })
      return
    }

    if (action === 'pipelines' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/pipelines`,
        query: {
          per_page: 30,
          page: query.get('page') ?? '1',
          status: query.get('status') ?? '',
          ref: query.get('ref') ?? '',
          order_by: 'id',
          sort: 'desc',
        },
      })
      ok(res, pageOf(result))
      return
    }

    if (action === 'pipeline' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const pipelineId = requiredQuery(query, 'pipelineId')
      const pipeline = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/pipelines/${encodeURIComponent(pipelineId)}`,
      })
      const jobs = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/pipelines/${encodeURIComponent(pipelineId)}/jobs`,
        query: { per_page: 100 },
      })
      ok(res, { pipeline: pipeline.data ?? {}, jobs: pageOf(jobs).items })
      return
    }

    if (action === 'job-trace' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const jobId = requiredQuery(query, 'jobId')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/jobs/${encodeURIComponent(jobId)}/trace`,
        text: true,
        timeoutMs: 30000,
      })
      const text = plainTrace(result.text ?? '')
      ok(res, {
        jobId,
        content: text.length > TRACE_TAIL ? text.slice(text.length - TRACE_TAIL) : text,
        truncated: text.length > TRACE_TAIL,
        size: Buffer.byteLength(text, 'utf8'),
      })
      return
    }

    if (action === 'pipeline/retry' && method === 'POST') {
      const body = await readJson(req)
      const result = await gitlab.request(instanceId, {
        method: 'POST',
        path: `/projects/${projectSegment(required(body, 'path'))}/pipelines/${encodeURIComponent(required(body, 'pipelineId'))}/retry`,
      })
      ok(res, result.data ?? {})
      return
    }

    if (action === 'pipeline/cancel' && method === 'POST') {
      const body = await readJson(req)
      const result = await gitlab.request(instanceId, {
        method: 'POST',
        path: `/projects/${projectSegment(required(body, 'path'))}/pipelines/${encodeURIComponent(required(body, 'pipelineId'))}/cancel`,
      })
      ok(res, result.data ?? {})
      return
    }

    if (action === 'job/retry' && method === 'POST') {
      const body = await readJson(req)
      const result = await gitlab.request(instanceId, {
        method: 'POST',
        path: `/projects/${projectSegment(required(body, 'path'))}/jobs/${encodeURIComponent(required(body, 'jobId'))}/retry`,
      })
      ok(res, result.data ?? {})
      return
    }

    if (action === 'job/cancel' && method === 'POST') {
      const body = await readJson(req)
      const result = await gitlab.request(instanceId, {
        method: 'POST',
        path: `/projects/${projectSegment(required(body, 'path'))}/jobs/${encodeURIComponent(required(body, 'jobId'))}/cancel`,
      })
      ok(res, result.data ?? {})
      return
    }

    if (action === 'job/play' && method === 'POST') {
      const body = await readJson(req)
      const result = await gitlab.request(instanceId, {
        method: 'POST',
        path: `/projects/${projectSegment(required(body, 'path'))}/jobs/${encodeURIComponent(required(body, 'jobId'))}/play`,
      })
      ok(res, result.data ?? {})
      return
    }

    if (action === 'merge-requests' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/merge_requests`,
        query: {
          state: query.get('state') ?? 'opened',
          per_page: 30,
          page: query.get('page') ?? '1',
          order_by: 'updated_at',
          sort: 'desc',
        },
      })
      ok(res, pageOf(result))
      return
    }

    if (action === 'merge-request' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const iid = requiredQuery(query, 'iid')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/merge_requests/${encodeURIComponent(iid)}`,
      })
      ok(res, result.data ?? {})
      return
    }

    if (action === 'issues' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/issues`,
        query: {
          state: query.get('state') ?? 'opened',
          per_page: 30,
          page: query.get('page') ?? '1',
          order_by: 'updated_at',
          sort: 'desc',
        },
      })
      ok(res, pageOf(result))
      return
    }

    if (action === 'issue' && method === 'GET') {
      const project = requiredQuery(query, 'path')
      const iid = requiredQuery(query, 'iid')
      const result = await gitlab.request(instanceId, {
        path: `/projects/${projectSegment(project)}/issues/${encodeURIComponent(iid)}`,
      })
      ok(res, result.data ?? {})
      return
    }

    throw Object.assign(new Error(`Unknown action "${action}".`), { status: 404, code: 'unknown_action' })
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!admit(req, res)) return
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const root = ROUTE_PREFIX.replace(/\/$/, '')
      if (!url.pathname.startsWith(root)) {
        json(res, 404, { ok: false, error: { code: 'not_found', message: 'not found' } })
        return
      }
      const action = url.pathname.slice(root.length).replace(/^\/+/, '').replace(/\/+$/, '')
      if (action === '') {
        json(res, 404, { ok: false, error: { code: 'unknown_action', message: 'unknown action' } })
        return
      }
      await dispatch(action, req, res, url)
    } catch (error) {
      const failure = error as RouteError
      if (failure instanceof GitLabError || failure?.code) {
        fail(res, failure)
        return
      }
      fail(res, Object.assign(new Error('The request failed.'), {
        status: 500,
        code: 'internal_error',
        detail: String((error as Error)?.message ?? error),
      }))
    }
  }
}
