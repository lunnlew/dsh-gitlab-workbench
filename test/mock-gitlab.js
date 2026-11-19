/**
 * A tiny stand-in for a self-managed GitLab instance, used to verify the
 * workbench end to end without a real server. It answers the subset of the v4
 * API the plugin calls, with the pagination headers GitLab sends.
 *
 * Usage: node test/mock-gitlab.js [port]
 */

import http from 'node:http'

const PORT = Number(process.argv[2] ?? 18080)
const TOKEN = 'test-token'

const now = Date.now()
const iso = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString()

const PROJECTS = [
  {
    id: 42,
    name: 'project',
    path: 'project',
    path_with_namespace: 'demo/project',
    name_with_namespace: 'Demo / project',
    description: 'A demo project served by the mock GitLab. It has pipelines, merge requests and issues.',
    default_branch: 'main',
    visibility: 'private',
    archived: false,
    star_count: 12,
    forks_count: 3,
    open_issues_count: 4,
    last_activity_at: iso(35),
    created_at: iso(20000),
    web_url: `http://127.0.0.1:${PORT}/demo/project`,
    avatar_url: '',
    namespace: { id: 1, name: 'demo', path: 'demo', kind: 'group', full_path: 'demo' },
  },
  {
    id: 43,
    name: 'infra',
    path: 'infra',
    path_with_namespace: 'demo/infra',
    name_with_namespace: 'Demo / infra',
    description: 'Infrastructure as code.',
    default_branch: 'main',
    visibility: 'internal',
    archived: false,
    star_count: 4,
    forks_count: 1,
    open_issues_count: 1,
    last_activity_at: iso(600),
    created_at: iso(30000),
    web_url: `http://127.0.0.1:${PORT}/demo/infra`,
    avatar_url: '',
    namespace: { id: 1, name: 'demo', path: 'demo', kind: 'group', full_path: 'demo' },
  },
]

const PIPELINES = [
  { id: 9001, iid: 101, project_id: 42, status: 'failed', source: 'push', ref: 'main', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', created_at: iso(30), updated_at: iso(22), web_url: `http://127.0.0.1:${PORT}/demo/project/-/pipelines/9001`, user: { username: 'alice', name: 'Alice Chen', avatar_url: '' } },
  { id: 9000, iid: 100, project_id: 42, status: 'running', source: 'merge_request_event', ref: 'feature/login', sha: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890', created_at: iso(12), updated_at: iso(1), web_url: `http://127.0.0.1:${PORT}/demo/project/-/pipelines/9000`, user: { username: 'bob', name: 'Bob Li', avatar_url: '' } },
  { id: 8999, iid: 99, project_id: 42, status: 'success', source: 'push', ref: 'main', sha: 'c3d4e5f60718293a4b5c6d7e8f90123456789012', created_at: iso(300), updated_at: iso(280), web_url: `http://127.0.0.1:${PORT}/demo/project/-/pipelines/8999`, user: { username: 'alice', name: 'Alice Chen', avatar_url: '' } },
]

const JOBS = {
  9001: [
    { id: 70001, name: 'lint', stage: 'test', status: 'failed', duration: 23.4, created_at: iso(30), web_url: '#', allow_failure: false },
    { id: 70002, name: 'unit', stage: 'test', status: 'success', duration: 61.2, created_at: iso(29), web_url: '#', allow_failure: false },
    { id: 70003, name: 'build', stage: 'build', status: 'success', duration: 88.1, created_at: iso(28), web_url: '#', allow_failure: false },
    { id: 70004, name: 'deploy', stage: 'deploy', status: 'skipped', duration: 0, created_at: iso(27), web_url: '#', allow_failure: false },
  ],
  9000: [
    { id: 70010, name: 'lint', stage: 'test', status: 'running', duration: 9.5, created_at: iso(12), web_url: '#', allow_failure: false },
    { id: 70011, name: 'build', stage: 'build', status: 'pending', duration: 0, created_at: iso(11), web_url: '#', allow_failure: false },
    { id: 70012, name: 'manual-deploy', stage: 'deploy', status: 'manual', duration: 0, created_at: iso(10), web_url: '#', allow_failure: false },
  ],
  8999: [
    { id: 70020, name: 'lint', stage: 'test', status: 'success', duration: 20.1, created_at: iso(300), web_url: '#', allow_failure: false },
  ],
}

const TRACES = {
  70001: [
    '$ eslint . --max-warnings 0',
    'src/app.js',
    '  12:7  error  Unexpected console statement  no-console',
    '  31:3  error  Missing semicolon  semi',
    '',
    '✖ 2 problems (2 errors, 0 warnings)',
    'ERROR: Job failed: exit code 1',
  ].join('\n'),
  70010: ['$ eslint . --max-warnings 0', 'Running lint…'].join('\n'),
}

const MRS = [
  {
    id: 501,
    iid: 12,
    project_id: 42,
    title: 'Fix login redirect loop',
    state: 'opened',
    description: 'The redirect after a failed login bounced between `/login` and `/`. This keeps the return URL only for same-origin paths.',
    source_branch: 'fix/login-redirect',
    target_branch: 'main',
    author: { username: 'bob', name: 'Bob Li', avatar_url: '' },
    assignees: [{ username: 'alice', name: 'Alice Chen', avatar_url: '' }],
    labels: ['bug', 'auth'],
    user_notes_count: 3,
    changes_count: '4',
    detailed_merge_status: 'mergeable',
    created_at: iso(400),
    updated_at: iso(40),
    web_url: `http://127.0.0.1:${PORT}/demo/project/-/merge_requests/12`,
    head_pipeline: { id: 9000, status: 'running', ref: 'fix/login-redirect', web_url: '#' },
    pipeline: { id: 9000, status: 'running', ref: 'fix/login-redirect', web_url: '#' },
    references: { short: '!12', full: 'demo/project!12', relative: '!12' },
  },
  {
    id: 502,
    iid: 11,
    project_id: 42,
    title: 'Add pipeline cache',
    state: 'opened',
    description: 'Cache node_modules between jobs.',
    source_branch: 'chore/ci-cache',
    target_branch: 'main',
    author: { username: 'alice', name: 'Alice Chen', avatar_url: '' },
    assignees: [],
    labels: ['ci'],
    user_notes_count: 0,
    changes_count: '2',
    detailed_merge_status: 'checking',
    created_at: iso(500),
    updated_at: iso(120),
    web_url: `http://127.0.0.1:${PORT}/demo/project/-/merge_requests/11`,
    head_pipeline: null,
    pipeline: null,
    references: { short: '!11', full: 'demo/project!11', relative: '!11' },
  },
]

const ISSUES = [
  {
    id: 801,
    iid: 31,
    project_id: 42,
    title: 'Session expires too early',
    state: 'opened',
    description: 'Users are logged out after 15 minutes.\n\nExpected: 8 hours.',
    author: { username: 'bob', name: 'Bob Li', avatar_url: '' },
    assignees: [{ username: 'alice', name: 'Alice Chen', avatar_url: '' }],
    labels: ['bug', 'session'],
    user_notes_count: 2,
    created_at: iso(900),
    updated_at: iso(200),
    web_url: `http://127.0.0.1:${PORT}/demo/project/-/issues/31`,
    references: { short: '#31', full: 'demo/project#31', relative: '#31' },
  },
]

const COMMITS = [
  { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', short_id: 'a1b2c3d4', title: 'Fix login redirect loop', author_name: 'Bob Li', authored_date: iso(400), committer_name: 'Bob Li', message: 'Fix login redirect loop' },
  { id: 'c3d4e5f60718293a4b5c6d7e8f90123456789012', short_id: 'c3d4e5f6', title: 'Cache node_modules in CI', author_name: 'Alice Chen', authored_date: iso(500), committer_name: 'Alice Chen', message: 'Cache node_modules in CI' },
  { id: 'd4e5f60718293a4b5c6d7e8f9012345678901234', short_id: 'd4e5f607', title: 'Update dependencies', author_name: 'Alice Chen', authored_date: iso(1600), committer_name: 'Alice Chen', message: 'Update dependencies' },
]

const BRANCHES = [
  { name: 'main', merged: false, protected: true, default: true, commit: { id: COMMITS[0].id, short_id: 'a1b2c3d4', title: 'Fix login redirect loop', authored_date: iso(400) } },
  { name: 'fix/login-redirect', merged: false, protected: false, default: false, commit: { id: COMMITS[0].id, short_id: 'a1b2c3d4', title: 'Fix login redirect loop', authored_date: iso(400) } },
  { name: 'chore/ci-cache', merged: false, protected: false, default: false, commit: { id: COMMITS[1].id, short_id: 'c3d4e5f6', title: 'Cache node_modules in CI', authored_date: iso(500) } },
]

const TAGS = [
  { name: 'v1.0.0', message: 'first release', commit: { id: COMMITS[0].id, short_id: 'a1b2c3d4', title: 'Fix login redirect loop', authored_date: iso(400) } },
  { name: 'v0.9.0', message: 'beta', commit: { id: COMMITS[1].id, short_id: 'c3d4e5f6', title: 'Cache node_modules in CI', authored_date: iso(500) } },
]

const TREE = {
  '': [
    { id: 't1', name: 'src', type: 'tree', path: 'src', mode: '040000' },
    { id: 't2', name: 'README.md', type: 'blob', path: 'README.md', mode: '100644' },
    { id: 't3', name: '.gitlab-ci.yml', type: 'blob', path: '.gitlab-ci.yml', mode: '100644' },
  ],
  src: [
    { id: 't4', name: 'app.js', type: 'blob', path: 'src/app.js', mode: '100644' },
    { id: 't5', name: 'login.js', type: 'blob', path: 'src/login.js', mode: '100644' },
  ],
}

const FILES = {
  'README.md': '# Demo project\n\nServed by the mock GitLab for dsh-gitlab-workbench.\n',
  '.gitlab-ci.yml': 'stages:\n  - test\n  - build\n\nlint:\n  stage: test\n  script: npm run lint\n',
  'src/app.js': "import { login } from './login.js'\n\nlogin().catch((error) => console.error(error))\n",
  'src/login.js': 'export async function login() {\n  return fetch("/api/session")\n}\n',
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain' })
  res.end(text)
}

function auth(req) {
  return req.headers['private-token'] === TOKEN || req.headers['PRIVATE-TOKEN'] === TOKEN
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const raw = url.pathname.replace(/^\/api\/v4/, '')
  const segments = raw
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })

  if (url.pathname === '/health') return sendText(res, 200, 'ok')
  if (!auth(req)) return sendJson(res, 401, { message: '401 Unauthorized' })

  if (segments.length === 1 && segments[0] === 'user') {
    return sendJson(res, 200, { id: 7, username: 'alice', name: 'Alice Chen', avatar_url: '', web_url: `http://127.0.0.1:${PORT}/alice` })
  }
  if (segments.length === 1 && segments[0] === 'version') return sendJson(res, 200, { version: '17.11.0-ee', revision: 'mock' })

  if (segments.length === 1 && segments[0] === 'projects') {
    const search = (url.searchParams.get('search') ?? '').toLowerCase()
    const items = PROJECTS.filter((p) => !search || p.path_with_namespace.toLowerCase().includes(search))
    res.setHeader('X-Total', String(items.length))
    res.setHeader('X-Page', '1')
    res.setHeader('X-Next-Page', '')
    return sendJson(res, 200, items)
  }

  if (segments[0] === 'projects' && segments.length >= 2) {
    const projectRef = segments[1]
    const rest = segments.length > 2 ? `/${segments.slice(2).join('/')}` : ''
    const project = PROJECTS.find((p) => String(p.id) === projectRef || p.path_with_namespace === projectRef)
    if (!project) return sendJson(res, 404, { message: '404 Project Not Found' })

    if (rest === '') return sendJson(res, 200, project)

    const list = (items, perPage = 30) => {
      const page = Number(url.searchParams.get('page') ?? '1')
      const start = (page - 1) * perPage
      const slice = items.slice(start, start + perPage)
      res.setHeader('X-Total', String(items.length))
      res.setHeader('X-Page', String(page))
      res.setHeader('X-Next-Page', start + perPage < items.length ? String(page + 1) : '')
      sendJson(res, 200, slice)
    }

    if (rest === '/repository/branches') return list(BRANCHES, 50)
    if (rest === '/repository/tags') return list(TAGS, 50)
    if (rest === '/repository/commits') return list(COMMITS, 30)
    if (rest === '/repository/tree') {
      const dir = url.searchParams.get('path') ?? ''
      return list(TREE[dir] ?? [], 100)
    }
    const fileMatch = rest.match(/^\/repository\/files\/(.+)\/raw$/)
    if (fileMatch) {
      const filePath = fileMatch[1]
      if (!(filePath in FILES)) return sendJson(res, 404, { message: '404 File Not Found' })
      return sendText(res, 200, FILES[filePath])
    }

    if (rest === '/pipelines') {
      const status = url.searchParams.get('status') ?? ''
      return list(PIPELINES.filter((p) => !status || p.status === status), 30)
    }
    const pipelineMatch = rest.match(/^\/pipelines\/(\d+)(\/jobs)?$/)
    if (pipelineMatch) {
      const pipeline = PIPELINES.find((p) => String(p.id) === pipelineMatch[1])
      if (!pipeline) return sendJson(res, 404, { message: '404 Not Found' })
      if (pipelineMatch[2]) return list(JOBS[pipeline.id] ?? [], 100)
      return sendJson(res, 200, pipeline)
    }
    const pipelineAction = rest.match(/^\/pipelines\/(\d+)\/(retry|cancel)$/)
    if (pipelineAction) {
      const pipeline = PIPELINES.find((p) => String(p.id) === pipelineAction[1])
      // Answer with the pipeline as it would look right after the action, but
      // keep the seed data stable for the next run.
      return sendJson(res, 200, { ...pipeline, status: pipelineAction[2] === 'retry' ? 'pending' : 'canceled' })
    }
    const jobMatch = rest.match(/^\/jobs\/(\d+)(\/trace|\/retry|\/cancel|\/play)?$/)
    if (jobMatch) {
      const jobId = Number(jobMatch[1])
      if (jobMatch[2] === '/trace') return sendText(res, 200, TRACES[jobId] ?? 'no trace')
      if (jobMatch[2] === '/retry') return sendJson(res, 200, { id: jobId, status: 'pending' })
      if (jobMatch[2] === '/cancel') return sendJson(res, 200, { id: jobId, status: 'canceled' })
      if (jobMatch[2] === '/play') return sendJson(res, 200, { id: jobId, status: 'pending' })
      if (jobMatch[2] === '/play') return sendJson(res, 200, { id: jobId, status: 'pending' })
      return sendJson(res, 200, { id: jobId, status: 'success' })
    }

    if (rest === '/merge_requests') return list(MRS, 30)
    const mrMatch = rest.match(/^\/merge_requests\/(\d+)$/)
    if (mrMatch) {
      const mr = MRS.find((m) => String(m.iid) === mrMatch[1])
      return mr ? sendJson(res, 200, mr) : sendJson(res, 404, { message: '404 Not Found' })
    }

    if (rest === '/issues') return list(ISSUES, 30)
    const issueMatch = rest.match(/^\/issues\/(\d+)$/)
    if (issueMatch) {
      const issue = ISSUES.find((i) => String(i.iid) === issueMatch[1])
      return issue ? sendJson(res, 200, issue) : sendJson(res, 404, { message: '404 Not Found' })
    }
  }

  return sendJson(res, 404, { message: '404 Not Found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock gitlab on http://127.0.0.1:${PORT} (token: ${TOKEN})`)
})

