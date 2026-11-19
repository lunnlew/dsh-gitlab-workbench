/**
 * Smoke-test the built client bundle outside the browser: load it through the
 * module loader format, apply it to a fake slot registry, and render every
 * registered component with react-dom/server. Effects do not run here, so this
 * catches element/type/prop mistakes, not data loading.
 *
 * Usage: node test/client-check.cjs
 */

const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const React = require('react')
const { renderToString } = require('react-dom/server')

const BUNDLE_ID = '@karoy/dsh-gitlab-workbench'

const registered = []
const fakeSlots = {
  inject(key, callback) {
    callback()
    return () => {}
  },
  register(options, component) {
    registered.push({ options, component })
    return () => {}
  },
}

const storage = new Map()
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  JSON,
  Promise,
  URL,
  URLSearchParams,
  fetch: async () => {
    throw new Error('fetch is not available in the smoke test')
  },
  location: { origin: 'http://127.0.0.1:49619' },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  },
  confirm: () => false,
  document: { documentElement: { lang: 'zh-CN' } },
}
sandbox.window = {
  __ModuleLoader__: {
    load: (entry) => {
      sandbox.__entry = entry
    },
  },
  location: sandbox.location,
  localStorage: sandbox.localStorage,
  confirm: sandbox.confirm,
  setTimeout,
  clearTimeout,
}
sandbox.globalThis = sandbox

const code = fs.readFileSync(path.join(__dirname, '..', 'dist', 'client.js'), 'utf8')
vm.runInNewContext(code, sandbox, { filename: 'client.js' })

const entry = sandbox.__entry
if (!entry) throw new Error('client bundle did not call window.__ModuleLoader__.load')
if (entry.id !== BUNDLE_ID) throw new Error(`unexpected bundle id ${entry.id}`)

const requireShim = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require ${name}`)
}
const plugin = entry.factory(requireShim)
if (!plugin || typeof plugin.apply !== 'function') throw new Error('factory did not return a plugin')
plugin.apply({ slots: fakeSlots })

console.log(`registered ${registered.length} slots`)
for (const item of registered) {
  const name = item.options.name
  const props = name === 'sidebar.panellist' ? { size: 20, active: true } : {}
  const html = renderToString(React.createElement(item.component, props))
  const expected = name === 'sidebar.panellist' ? '<svg' : 'GitLab'
  if (!html.includes(expected)) throw new Error(`component for ${name} did not render the expected markup`)
  console.log(`  ok ${name} (${html.length} chars)`)
}

const main = registered.find((item) => item.options.name === 'main')
if (!main) throw new Error('the main panel was not registered')
if (main.options.key !== 'gitlab-workbench') throw new Error('wrong main panel key')

const icon = registered.find((item) => item.options.name === 'sidebar.panellist')
if (!icon || icon.options.id !== 'gitlab-workbench') throw new Error('the sidebar entry was not registered')
if (typeof icon.options.label !== 'function' || icon.options.label() !== 'GitLab') {
  throw new Error('the sidebar label is not "GitLab"')
}

console.log('CLIENT SMOKE TEST PASSED')
