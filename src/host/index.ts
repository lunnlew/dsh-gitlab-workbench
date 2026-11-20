/**
 * dsh-gitlab-workbench — the host half.
 *
 * It owns the instance list, the personal access tokens (through the host
 * credential service) and every GitLab request. The browser half is a left
 * sidebar entry and the global panel it opens; it reaches this half through the
 * same-origin routes registered below and never sees a token.
 *
 * Build: `npm run build` (tsc for this half, esbuild for the client).
 */
import { readFileSync } from 'node:fs'
import { createGitLab } from './gitlab.js'
import { createRoutes, ROUTE_PREFIX } from './routes.js'
import { createInstanceStore } from './store.js'
import type { PluginContext } from './types.js'

/**
 * The plugin version reported by the routes and the log line.
 *
 * It is read from the installed `package.json` instead of being written here,
 * so a release bump cannot leave this copy stale. The build writes this file
 * to `dist/host/`, so the manifest is two directories up; `new URL` rather
 * than a `require()` specifier also keeps it independent of the `exports` table.
 */
export const VERSION: string = (() => {
  try {
    const text = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    const manifest = JSON.parse(text) as { version?: unknown }
    return typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

/** The route table needs the web server. */
export const inject = ['webServer']

/**
 * Install the host half.
 *
 * @param ctx The plugin context.
 * @param config The row configuration (unused; instances live in the panel).
 */
export function apply(ctx: PluginContext, config: Record<string, unknown> = {}): void {
  const logger = ctx.logger
  const store = createInstanceStore({ ctx, logger })
  const gitlab = createGitLab({ store, logger })
  const handle = createRoutes({ ctx, store, gitlab, version: VERSION })

  const register = () => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX.replace(/\/$/, ''),
    handler: (req, res) => {
      Promise.resolve(handle(req, res)).catch((error) => {
        logger?.warn?.('gitlab-workbench: a route failed', { error: String((error as Error)?.message ?? error) })
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: { code: 'internal_error', message: 'The request failed.' } }))
        }
      })
    },
  })

  if (typeof ctx.effect === 'function') {
    ctx.effect(register, 'gitlab-workbench: api routes')
  } else {
    register()
  }

  logger?.info?.('gitlab-workbench: ready', {
    version: VERSION,
    instances: store.list().length,
    credentials: store.hasCredentials() ? 'ready' : 'missing',
    config: Object.keys(config ?? {}).length,
  })
}
