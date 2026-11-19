/**
 * A stand-in for the DSH web shell, used only to look at the panel in a real
 * browser before the host restarts. It serves the client bundle with the React
 * UMD builds and answers the same routes the plugin registers.
 *
 * Usage: node test/preview-server.mjs [port]
 */

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createInstanceStore } from '../dist/host/store.js'
import { createGitLab } from '../dist/host/gitlab.js'
import { createRoutes } from '../dist/host/routes.js'

const localRequire = createRequire(import.meta.url)
const reactRoot = path.dirname(localRequire.resolve('react'))
const reactDomRoot = path.dirname(localRequire.resolve('react-dom'))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const PORT = Number(process.argv[2] ?? 18082)
const MOCK = Number(process.argv[3] ?? 18080)
/** A throwaway store: the preview never touches the real ~/.dsh data. */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glw-preview-'))
process.on('exit', () => fs.rmSync(dataDir, { recursive: true, force: true }))

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

let instance = store.list().find((entry) => entry.endpoint === `http://127.0.0.1:${MOCK}`)
if (!instance) instance = store.add({ label: 'acme gitlab', endpoint: `http://127.0.0.1:${MOCK}`, verifyTls: false })
await store.writeToken(instance.id, { token: 'test-token', username: 'alice', name: 'Alice Chen' })
store.setStatus(instance.id, {
  ok: true,
  user: { username: 'alice', name: 'Alice Chen', avatarUrl: '', webUrl: '' },
  version: '17.11.0-ee',
})

const THEME = `
:root{
  --dsw-alias-bg-base:#1b1c1f;
  --dsw-alias-bg-layer-1:#232529;
  --dsw-alias-bg-layer-2:#2b2e34;
  --dsw-alias-bg-overlay:#26282d;
  --dsw-alias-border-l1:#33363c;
  --dsw-alias-border-l2:#43474e;
  --dsw-alias-brand-primary:#5b9dff;
  --dsw-alias-label-primary:#e9ebee;
  --dsw-alias-label-secondary:#9aa0a7;
  --dsw-alias-state-error-primary:#f06a63;
  --dsw-alias-state-idle-primary:#7d838b;
  --dsw-alias-state-success-primary:#4bbf73;
  --dsw-alias-state-warn-primary:#e5a83d;
  --dsh-frame-top-clearance:0px;
  color-scheme: dark;
}
html.light{
  --dsw-alias-bg-base:#ffffff;
  --dsw-alias-bg-layer-1:#f7f8fa;
  --dsw-alias-bg-layer-2:#eef0f3;
  --dsw-alias-bg-overlay:#ffffff;
  --dsw-alias-border-l1:#e3e5e9;
  --dsw-alias-border-l2:#d2d6dc;
  --dsw-alias-brand-primary:#2f6fed;
  --dsw-alias-label-primary:#1d2129;
  --dsw-alias-label-secondary:#6b7280;
  --dsw-alias-state-error-primary:#d92d20;
  --dsw-alias-state-idle-primary:#98a2b3;
  --dsw-alias-state-success-primary:#12b76a;
  --dsw-alias-state-warn-primary:#dc9a15;
  color-scheme: light;
}
html,body{margin:0;height:100%;background:#111214;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
html.light,html.light body{background:#e9ebef}
#root{width:100%;height:100%}
`

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>GitLab workbench preview</title>
<style>${THEME}</style>
</head>
<body>
<div id="root"></div>
<script>window.__ModuleLoader__ = { load: function (entry) { window.__entry = entry } }</script>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script src="/client.js"></script>
<script>
(function () {
  var entry = window.__entry
  if (!entry) { document.body.textContent = 'bundle did not load'; return }
  var registered = []
  var plugin = entry.factory(function (name) {
    if (name === 'react') return window.React
    throw new Error('unexpected require ' + name)
  })
  plugin.apply({
    slots: {
      inject: function (name, callback) { callback(); return function () {} },
      register: function (options, component) { registered.push({ options: options, component: component }); return function () {} },
    },
  })
  var main = registered.filter(function (item) { return item.options.name === 'main' })[0]
  window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(main.component))
})()
</script>
</body>
</html>`

const files = {
  '/client.js': { file: path.join(ROOT, 'dist', 'client.js'), type: 'text/javascript; charset=utf-8' },
  '/react.js': { file: path.join(reactRoot, 'umd', 'react.development.js'), type: 'text/javascript; charset=utf-8' },
  '/react-dom.js': { file: path.join(reactDomRoot, 'umd', 'react-dom.development.js'), type: 'text/javascript; charset=utf-8' },
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(PAGE.replace('<html lang="zh-CN">', `<html lang="zh-CN" class="${url.searchParams.get('theme') === 'light' ? 'light' : ''}">`))
      return
    }
    const file = files[url.pathname]
    if (file) {
      fs.readFile(file.file, (error, buffer) => {
        if (error) {
          res.writeHead(404)
          res.end('missing')
          return
        }
        res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-store' })
        res.end(buffer)
      })
      return
    }
    if (url.pathname.startsWith('/gitlab-workbench/api')) {
      await handle(req, res)
      return
    }
    res.writeHead(404)
    res.end('not found')
  } catch (error) {
    console.error('preview request failed', error)
    if (!res.headersSent) res.writeHead(500)
    res.end('error')
  }
})

server.on('clientError', (error, socket) => {
  console.error('client error', error.message)
  socket.destroy()
})
process.on('uncaughtException', (error) => console.error('uncaught', error))
process.on('unhandledRejection', (error) => console.error('unhandled', error))

server.listen(PORT, '127.0.0.1', () => {
  console.log(`preview on http://127.0.0.1:${PORT} (instance ${instance.id})`)
})



