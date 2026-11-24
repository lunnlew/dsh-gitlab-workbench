/**
 * End-to-end test of the browser half against the mock GitLab.
 *
 * It starts the built host routes on 18081 with an in-memory credential store,
 * loads dist/client.js into jsdom through the module-loader format, mounts the
 * global panel, and walks the UI: projects → project → pipelines → job log →
 * merge requests → issues → files → settings.
 *
 * Usage: node test/client-e2e.mjs [mockPort]
 */

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createInstanceStore } from '../dist/host/store.js'
import { createGitLab } from '../dist/host/gitlab.js'
import { createRoutes } from '../dist/host/routes.js'

const localRequire = createRequire(import.meta.url)
const { JSDOM } = localRequire('jsdom')
const React = localRequire('react')
const ReactDOMClient = localRequire('react-dom/client')

const MOCK = Number(process.argv[2] ?? 18080)
const PORT = 18081
const MOCK_USER = { username: 'alice', name: 'Alice Chen' }
/** A throwaway store: the tests never touch the real ~/.dsh data. */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glw-e2e-'))

const records = new Map()
const ctx = {
  credentials: {
    readRecord: async (key) => records.get(key),
    modifyRecord: async (key, mutate) => {
      const next = await mutate(records.get(key))
      if (next === undefined) records.delete(key)
      else records.set(key, next)
      return next
    },
    deleteRecord: async (key) => records.delete(key),
  },
  connection: { requestRejection: () => undefined },
  logger: { info: () => {}, warn: () => {} },
}
ctx.get = (name) => (name === 'credentials' ? ctx.credentials : name === 'connection' ? ctx.connection : undefined)
const store = createInstanceStore({ ctx, dataDir })
const gitlab = createGitLab({ store })
const handle = createRoutes({ ctx, store, gitlab, version: '0.2.0' })

for (const existing of store.list()) {
  if (existing.endpoint.includes(`127.0.0.1:${MOCK}`)) void store.remove(existing.id)
}
const instance = store.add({ label: 'mock', endpoint: `http://127.0.0.1:${MOCK}`, verifyTls: false })
await store.writeToken(instance.id, { token: 'test-token', username: MOCK_USER.username, name: MOCK_USER.name })
store.setStatus(instance.id, {
  ok: true,
  user: { username: MOCK_USER.username, name: MOCK_USER.name, avatarUrl: '', webUrl: '' },
  version: '17.11.0-ee',
})

const server = http.createServer((req, res) => handle(req, res))
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

const dom = new JSDOM('<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>', {
  url: `http://127.0.0.1:${PORT}/`,
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})
Object.defineProperty(dom.window.navigator, 'language', { value: 'zh-CN', configurable: true })
dom.window.fetch = (input, init) => {
  const target = typeof input === 'string' && input.startsWith('/') ? `http://127.0.0.1:${PORT}${input}` : input
  return fetch(target, init)
}
dom.window.confirm = () => true
// jsdom misses the IE-era hooks React probes before it trusts `input` events.
dom.window.Element.prototype.attachEvent = () => {}
dom.window.Element.prototype.detachEvent = () => {}

globalThis.window = dom.window
globalThis.document = dom.window.document
try {
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
} catch {
  // Node exposes navigator as a getter; the bundle reads the jsdom one anyway.
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false

const code = fs.readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')
dom.window.__ModuleLoader__ = { load: (value) => { dom.window.__entry = value } }
dom.window.eval(code)
const entry = dom.window.__entry
const requireShim = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require ${name}`)
}
const plugin = entry.factory(requireShim)

const registered = []
plugin.apply({
  slots: {
    inject: (name, callback) => {
      callback()
      return () => {}
    },
    register: (options, component) => {
      registered.push({ options, component })
      return () => {}
    },
  },
})

const main = registered.find((item) => item.options.name === 'main')
const container = dom.window.document.getElementById('root')
const root = ReactDOMClient.createRoot(container)
root.render(React.createElement(main.component))

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(label, predicate, timeout = 6000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      if (predicate()) return
    } catch {
      // Keep waiting; the tree may be between states.
    }
    await tick(80)
  }
  const html = container.innerHTML.replace(/<style>[\s\S]*?<\/style>/g, '')
  throw new Error(`timed out waiting for ${label}. Current HTML: ${html.slice(0, 1200)}`)
}

const text = () => container.textContent ?? ''
const buttons = (selector) => [...container.querySelectorAll(selector)]

function buttonWith(label, selector = 'button') {
  return buttons(selector).find((button) => (button.textContent ?? '').includes(label))
}

async function clickButton(label, selector = 'button') {
  await waitFor(`button ${label}`, () => Boolean(buttonWith(label, selector)))
  buttonWith(label, selector).click()
  await tick()
}

function expect(value, message) {
  if (!value) throw new Error(message)
}

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`  ok   ${label}`)
}

await waitFor('panel title', () => text().includes('GitLab'))
ok('panel title')

await waitFor('project rail', () => buttons('.gw-project').length > 0)
ok('project rail')

buttons('.gw-project')[0].click()
await waitFor('project overview', () => Boolean(container.querySelector('.gw-stats')))
ok('project overview')

await clickButton('克隆地址', '.gw-clone button')
await waitFor('clone popover', () => Boolean(container.querySelector('.gw-clone-pop')))
const cloneUrls = [...container.querySelectorAll('.gw-clone-url')].map((input) => input.value)
expect(
  cloneUrls.includes('http://127.0.0.1:18080/demo/project.git') && cloneUrls.includes('git@127.0.0.1:demo/project.git'),
  'the clone popover should show HTTPS and SSH urls',
)
ok('clone urls')
container.querySelector('.gw-clone button').click()
await tick()

await waitFor('branch picker', () => container.querySelector('.gw-branch-picker .gw-branch-name')?.textContent === 'main')
ok('branch picker beside the project name')

container.querySelector('.gw-branch-picker .gw-branch').click()
await waitFor('branch popover', () => Boolean(container.querySelector('.gw-popover')))
const popoverItems = () => [...container.querySelectorAll('.gw-popover-item')]
const groupTitles = () => [...container.querySelectorAll('.gw-popover-group-title')].map((node) => node.textContent)
expect(
  popoverItems().length >= 5 && groupTitles().includes('分支') && groupTitles().includes('Tags'),
  'the picker should group branches and tags',
)
ok('branches and tags are grouped')

const search = container.querySelector('.gw-popover-search')
expect(search !== null, 'the branch list should have a search field')
popoverItems().find((item) => item.textContent === 'chore/ci-cache')?.click()
await waitFor('branch switched', () => container.querySelector('.gw-branch-picker .gw-branch-name')?.textContent === 'chore/ci-cache')
ok('branch switched from the list')

buttons('.gw-project')[1].click()
await waitFor('other project', () => container.querySelector('.gw-h1')?.textContent === 'infra')
buttons('.gw-project')[0].click()
await waitFor('back to first project', () => container.querySelector('.gw-h1')?.textContent === 'project')
await waitFor('branch restored', () => container.querySelector('.gw-branch-picker .gw-branch-name')?.textContent === 'chore/ci-cache')
ok('branch remembered per project')

// A project with CI/CD switched off answers the pipelines endpoint with 403.
// That is not a token problem: the tab disappears and the overview says how to
// turn CI/CD on, instead of showing "the token is not allowed to read this".
const ciOffProject = buttons('.gw-project').find((button) => (button.textContent ?? '').includes('ci-off'))
expect(Boolean(ciOffProject), 'the rail should list the CI-off project')
ciOffProject.click()
await waitFor('ci-off project', () => container.querySelector('.gw-h1')?.textContent === 'ci-off')
await waitFor('pipeline tab hidden', () => !buttons('.gw-tabs button').some((button) => button.textContent === '流水线'))
await waitFor('CI/CD off explanation', () => text().includes('打开 CI/CD'))
const ciOffTabs = buttons('.gw-tabs button').map((button) => button.textContent)
expect(ciOffTabs.includes('概览') && ciOffTabs.includes('文件'), 'the other tabs should stay')
ok('CI/CD off hides the pipeline tab')
buttons('.gw-project')[0].click()
await waitFor('back to the first project', () => container.querySelector('.gw-h1')?.textContent === 'project')

container.querySelector('.gw-branch-picker .gw-branch').click()
await waitFor('branch popover for tag', () => Boolean(container.querySelector('.gw-popover')))
const tagItem = popoverItems().find((item) => item.textContent === 'v1.0.0')
expect(Boolean(tagItem), 'a tag should be listed')
tagItem.click()
await waitFor('tag selected', () => container.querySelector('.gw-branch-picker .gw-branch-name')?.textContent === 'v1.0.0')
ok('tag selection')

container.querySelector('.gw-branch-picker .gw-branch').click()
await waitFor('branch popover for all', () => Boolean(container.querySelector('.gw-popover')))
popoverItems().find((item) => (item.textContent ?? '').includes('全部'))?.click()
await waitFor('all refs selected', () => container.querySelector('.gw-branch-picker .gw-branch-name')?.textContent?.includes('全部'))
ok('all refs option')

container.querySelector('.gw-branch-picker .gw-branch').click()
await waitFor('branch popover again', () => Boolean(container.querySelector('.gw-popover')))
popoverItems().find((item) => item.textContent === 'main')?.click()
await waitFor('back on main', () => container.querySelector('.gw-branch-picker .gw-branch-name')?.textContent === 'main')

await clickButton('流水线', '.gw-tabs button')
await waitFor('pipeline list', () => buttons('.gw-pipe-row').length > 0)
ok('pipeline list')

buttons('.gw-pipe-row')[0].click()
await waitFor('pipeline jobs', () => buttons('.gw-job').length > 0 && text().includes('deploy'))
ok('pipeline detail with jobs')

await clickButton('日志', '.gw-job button')
await waitFor('job log', () => text().includes('Job failed'))
expect(Boolean(buttonWith('下载', '.gw-log-head button')), 'the job log should offer a download button')
ok('job log with download')

const pipe9000 = buttons('.gw-pipe-row').find((row) => (row.textContent ?? '').includes('#9000'))
pipe9000.click()
await waitFor(
  'pipeline 9000 detail',
  () => container.querySelector('.gw-detail-title h2')?.textContent === '#9000' && buttons('.gw-job').length > 0,
)
const manualRow = buttons('.gw-job').find((row) => (row.textContent ?? '').includes('manual-deploy'))
expect(Boolean(manualRow && [...manualRow.querySelectorAll('button')].some((b) => b.textContent === '运行')), 'manual job needs a run button')
ok('manual job offers run')
await clickButton('运行', '.gw-job button')
await tick(200)

const pipe9001 = buttons('.gw-pipe-row').find((row) => (row.textContent ?? '').includes('#9001'))
pipe9001.click()
await waitFor(
  'pipeline 9001 detail',
  () => container.querySelector('.gw-detail-title h2')?.textContent === '#9001' && text().includes('unit'),
)
const doneRow = buttons('.gw-job').find((row) => (row.textContent ?? '').includes('unit'))
expect(Boolean(doneRow && [...doneRow.querySelectorAll('button')].some((b) => b.textContent === '重试')), 'finished job needs a retry button')
ok('completed job offers retry')

await clickButton('合并请求', '.gw-tabs button')
await waitFor('merge request list', () => text().includes('Fix login redirect loop'))
buttons('.gw-table-row')[0].click()
await waitFor('merge request detail', () => text().includes('redirect after a failed login'))
ok('merge request detail')
buttonWith('返回', '.gw-detail-head button')?.click()
await tick()

await clickButton('议题', '.gw-tabs button')
await waitFor('issue list', () => text().includes('Session expires too early'))
buttons('.gw-table-row')[0].click()
await waitFor('issue detail', () => text().includes('logged out after 15 minutes'))
ok('issue detail')
buttonWith('返回', '.gw-detail-head button')?.click()
await tick()

await clickButton('文件', '.gw-tabs button')
await waitFor('file tree', () => text().includes('README.md'))
expect(text().includes('项'), 'the tree should show an item count')
ok('file tree with item count')
await clickButton('README.md', '.gw-tree-row')
await waitFor('file content', () => text().includes('# Demo project'))
ok('file viewer')

await buttons('button[aria-label="返回"]')[0].click()
await waitFor('tree after back', () => Boolean(buttonWith('src', '.gw-tree-row')))
await clickButton('src', '.gw-tree-row')
await waitFor('subdirectory tree', () => text().includes('app.js') && text().includes('login.js'))
ok('directory navigation')
await clickButton('app.js', '.gw-tree-row')
await waitFor('file in subdirectory', () => text().includes('import { login }'))
ok('file in subdirectory')
await buttons('button[aria-label="返回"]')[0].click()
await tick()

buttons('button[aria-label="实例与令牌"]')[0].click()
await waitFor('settings view', () => Boolean(container.querySelector('.gw-settings')))
ok('settings view')

await waitFor('token page link', () => Boolean(container.querySelector('a[href$="/-/user_settings/personal_access_tokens"]')))
const tokenHref = container.querySelector('a[href$="/-/user_settings/personal_access_tokens"]').getAttribute('href')
expect(tokenHref === 'http://127.0.0.1:18080/-/user_settings/personal_access_tokens', `unexpected token link ${tokenHref}`)
ok('token page link')

await clickButton('返回工作台', '.gw-set-main button')
await waitFor('workbench after back', () => Boolean(container.querySelector('.gw-shell')))
ok('settings back to workbench')

await clickButton('添加实例', '.gw-rail-action')
await waitFor('new instance form', () => text().includes('新实例') && Boolean(container.querySelector('#gw-url')))
ok('rail add-instance entry')

await clickButton('取消', '.gw-actions button')
await waitFor('previous instance restored', () => {
  const heading = container.querySelector('.gw-set-title h2')
  return heading?.textContent === 'mock' && !text().includes('新实例')
})
ok('cancel restores previous instance')

expect(buttons('.gw-log-body').length === 0, 'log panel should be closed after leaving the pipeline tab')

root.unmount()
server.close()
await store.remove(instance.id)
dom.window.close()
fs.rmSync(dataDir, { recursive: true, force: true })
console.log(`CLIENT E2E PASSED (${passed} checks)`)
