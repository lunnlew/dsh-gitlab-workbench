/**
 * Exercise the host routes against the mock GitLab, without the DSH runtime.
 * Usage: node test/host-check.js [mockPort]
 */

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInstanceStore } from '../dist/host/store.js'
import { createGitLab } from '../dist/host/gitlab.js'
import { createRoutes, ROUTE_PREFIX } from '../dist/host/routes.js'

const MOCK = Number(process.argv[2] ?? 18080)
const PORT = 18081
const log = (...args) => console.log(...args)

/** A throwaway store: the tests never touch the real ~/.dsh data. */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glw-host-'))

const registered = []
const credentialRecords = new Map()
const credentials = {
  readRecord: async (key) => credentialRecords.get(key),
  modifyRecord: async (key, mutate) => {
    const next = await mutate(credentialRecords.get(key))
    if (next === undefined) credentialRecords.delete(key)
    else credentialRecords.set(key, next)
    return next
  },
  deleteRecord: async (key) => {
    credentialRecords.delete(key)
  },
}
const connection = { requestRejection: () => undefined }
const services = { credentials, connection }
const ctx = {
  get: (name) => services[name],
  webServer: {
    register: (route) => {
      registered.push(route)
      return () => {}
    },
  },
  logger: { info: () => {}, warn: (...args) => console.warn(...args) },
}

// Cordis 4 refuses a service property that is not in `inject`; the plugin must
// therefore only use ctx.get(). These getters make that mistake fail the test.
for (const name of ['credentials', 'connection']) {
  Object.defineProperty(ctx, name, {
    configurable: true,
    get() {
      throw new Error(`cannot get property "${name}" without inject`)
    },
  })
}

const store = createInstanceStore({ ctx, logger: ctx.logger, dataDir })
const gitlab = createGitLab({ store, logger: ctx.logger })
const handle = createRoutes({ ctx, store, gitlab, version: '0.2.0' })

// A preview shell may have added this same endpoint already; start clean.
for (const existing of store.list()) {
  if (existing.endpoint.includes(`127.0.0.1:${MOCK}`)) await store.remove(existing.id)
}

const server = http.createServer((req, res) => handle(req, res))
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
log(`host routes on http://127.0.0.1:${PORT}${ROUTE_PREFIX}`)

async function call(action, { method = 'GET', query = {}, body } = {}) {
  const url = new URL(`http://127.0.0.1:${PORT}${ROUTE_PREFIX}${action}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  return { status: response.status, ...payload }
}

function check(label, condition, detail) {
  if (condition) {
    log(`  ok   ${label}`)
  } else {
    log(`  FAIL ${label}`, detail ?? '')
    process.exitCode = 1
  }
}

const instances = await call('instances')
check('instances list', instances.ok === true && Array.isArray(instances.data.items))

const added = await call('instances/add', {
  method: 'POST',
  body: { label: 'mock', endpoint: `http://127.0.0.1:${MOCK}`, verifyTls: false },
})
check('add instance', added.ok === true, added.error)
const id = added.data.id
log(`  instance ${id} ${added.data.endpoint}`)

const badToken = await call('instances/token', { method: 'POST', body: { id, token: 'nope' } })
check('reject bad token', badToken.ok === false && badToken.error.code === 'invalid_token', badToken.error)

const token = await call('instances/token', { method: 'POST', body: { id, token: 'test-token' } })
check('store token and test', token.ok === true && token.data.status.ok === true, token.error ?? token.data?.status)
check('version read', token.data?.status?.version === '17.11.0-ee', token.data?.status?.version)

const list = await call('instances')
check('instances has token', list.data.items.some((item) => item.id === id && item.hasToken))

const projects = await call('projects', { query: { id, search: 'demo' } })
check('projects', projects.ok === true && projects.data.items.length === 5, projects.error)

const project = await call('project', { query: { id, path: 'demo/project' } })
check('project detail', project.ok === true && project.data.project.path_with_namespace === 'demo/project', project.error)
check('open mr count', project.data?.openMergeRequests === 2, project.data?.openMergeRequests)

const branches = await call('branches', { query: { id, path: 'demo/project' } })
check('branches', branches.ok === true && branches.data.items.length === 3, branches.error)

const commits = await call('commits', { query: { id, path: 'demo/project', ref: 'main' } })
check('commits', commits.ok === true && commits.data.items.length === 3, commits.error)

const tree = await call('tree', { query: { id, path: 'demo/project', dir: '' } })
check('tree', tree.ok === true && tree.data.items.some((entry) => entry.name === 'src'), tree.error)

const file = await call('file', { query: { id, path: 'demo/project', filePath: 'README.md', ref: 'main' } })
check('file', file.ok === true && file.data.content.startsWith('# Demo project'), file.error)

const pipelines = await call('pipelines', { query: { id, path: 'demo/project' } })
check('pipelines', pipelines.ok === true && pipelines.data.items.length === 3, pipelines.error)

const failed = await call('pipelines', { query: { id, path: 'demo/project', status: 'failed' } })
check('pipeline filter', failed.ok === true && failed.data.items.length === 1, failed.error)

// GitLab answers 403 both for a token that cannot read pipelines and for a
// project that simply has none; only the project payload separates them.
const ciOff = await call('pipelines', { query: { id, path: 'demo/ci-off' } })
check(
  'CI/CD off is reported, not a token error',
  ciOff.ok === true && ciOff.data.ciDisabled === true && ciOff.data.reason === 'ci_disabled' && ciOff.data.items.length === 0,
  ciOff.error,
)

const ciOffFiltered = await call('pipelines', { query: { id, path: 'demo/ci-off', status: 'failed' } })
check('CI/CD off survives a status filter', ciOffFiltered.ok === true && ciOffFiltered.data.ciDisabled === true, ciOffFiltered.error)

const emptyRepo = await call('pipelines', { query: { id, path: 'demo/empty' } })
check(
  'an empty repository is reported as such',
  emptyRepo.ok === true && emptyRepo.data.ciDisabled === true && emptyRepo.data.reason === 'empty_repo',
  emptyRepo.error,
)

const denied = await call('pipelines', { query: { id, path: 'demo/locked' } })
check(
  'a real pipeline 403 still fails',
  denied.ok === false && denied.status === 403 && denied.error.code === 'forbidden',
  denied.error,
)

const pipeline = await call('pipeline', { query: { id, path: 'demo/project', pipelineId: 9001 } })
check('pipeline detail', pipeline.ok === true && pipeline.data.jobs.length === 4, pipeline.error)

const trace = await call('job-trace', { query: { id, path: 'demo/project', jobId: 70001 } })
check('job trace', trace.ok === true && trace.data.content.includes('Job failed'), trace.error)

const retried = await call('pipeline/retry', { method: 'POST', query: { id }, body: { path: 'demo/project', pipelineId: 9001 } })
check('pipeline retry', retried.ok === true && retried.data.status === 'pending', retried.error)

const canceled = await call('job/cancel', { method: 'POST', query: { id }, body: { path: 'demo/project', jobId: 70010 } })
check('job cancel', canceled.ok === true && canceled.data.status === 'canceled', canceled.error)

const played = await call('job/play', { method: 'POST', query: { id }, body: { path: 'demo/project', jobId: 70011 } })
check('job play', played.ok === true && played.data.status === 'pending', played.error)

const mrs = await call('merge-requests', { query: { id, path: 'demo/project' } })
check('merge requests', mrs.ok === true && mrs.data.items.length === 2, mrs.error)

const mr = await call('merge-request', { query: { id, path: 'demo/project', iid: 12 } })
check('merge request detail', mr.ok === true && mr.data.iid === 12, mr.error)

const issues = await call('issues', { query: { id, path: 'demo/project' } })
check('issues', issues.ok === true && issues.data.items.length === 1, issues.error)

const issue = await call('issue', { query: { id, path: 'demo/project', iid: 31 } })
check('issue detail', issue.ok === true && issue.data.iid === 31, issue.error)

const unknown = await call('nope')
check('unknown action 404', unknown.ok === false && unknown.status === 404)

const removed = await call('instances/remove', { method: 'POST', body: { id } })
check('remove instance', removed.ok === true && removed.data.removed === true)

const after = await call('instances')
check('instance gone', !after.data.items.some((item) => item.id === id))

server.close()
fs.rmSync(dataDir, { recursive: true, force: true })
log(process.exitCode ? 'FAILED' : 'ALL CHECKS PASSED')


