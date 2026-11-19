/**
 * Instances of the GitLab workbench.
 *
 * The instance list is a small JSON document under the DSH home directory; the
 * personal access token never goes there. Each token is stored as a record of
 * the host credential service under `gitlab-workbench/<instance id>`, so the
 * browser half never receives it and the record survives restarts.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import type {
  CredentialRecord,
  CredentialService,
  Instance,
  InstanceStatus,
  Logger,
  PluginContext,
  TokenPayload,
} from './types.js'

/** The credential scope every record of this plugin is stored under. */
export const CREDENTIAL_SCOPE = 'gitlab-workbench'

/** The one shape the credential service accepts for one half of a key. */
const SEGMENT = /^[a-z][a-z0-9-]*$/

const DEFAULT_DIR = path.join(os.homedir(), '.dsh', 'gitlab-workbench')

interface AddInstanceInput {
  label?: string
  endpoint: string
  verifyTls?: boolean
  caPem?: string
}

interface UpdateInstanceInput {
  label?: string
  endpoint?: string
  verifyTls?: boolean
  caPem?: string | null
}

export interface InstanceStore {
  list(): Instance[]
  get(id: string): Instance | undefined
  add(input: AddInstanceInput): Instance
  update(id: string, patch: UpdateInstanceInput): Promise<Instance>
  remove(id: string): Promise<boolean>
  readToken(id: string): Promise<TokenPayload | undefined>
  writeToken(id: string, payload: TokenPayload): Promise<void>
  removeToken(id: string): Promise<void>
  setStatus(id: string, status: InstanceStatus): void
  getStatus(id: string): InstanceStatus | undefined
  hasCredentials(): boolean
}

/** Report whether a string is a value a credential key segment may carry. */
function validSegment(value: unknown): value is string {
  return typeof value === 'string' && SEGMENT.test(value)
}

/**
 * Normalize an instance root URL.
 *
 * The endpoint is the instance root, not the API root: calls append `/api/v4`.
 * A pasted API URL is accepted and reduced to the root, and a trailing slash is
 * dropped so two spellings of one instance do not create two entries.
 */
export function normalizeEndpoint(raw: string): string {
  const text = String(raw ?? '').trim()
  if (text === '') throw new Error('Instance URL is required.')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('Instance URL is not a valid absolute URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Instance URL must use http or https.')
  }
  if (url.username || url.password) throw new Error('Instance URL must not contain credentials.')
  let base = `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  base = base.replace(/\/api\/v4$/i, '').replace(/\/+$/, '')
  if (!/^https?:\/\/[^/]+/i.test(base)) throw new Error('Instance URL is not a valid absolute URL.')
  return base
}

/** Build the credential key of one instance. */
export function credentialKeyFor(instanceId: string): string {
  if (!validSegment(instanceId)) throw new TypeError('Invalid instance id for a credential key.')
  return `${CREDENTIAL_SCOPE}/${instanceId}`
}

interface InstanceDocument {
  version: number
  instances: Instance[]
}

function loadDocument(file: string): InstanceDocument {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(text) as Partial<InstanceDocument>
    const instances = Array.isArray(parsed?.instances) ? parsed.instances : []
    return { version: 1, instances: instances.filter((entry) => entry && validSegment(entry.id)) }
  } catch {
    return { version: 1, instances: [] }
  }
}

function saveDocument(file: string, document: InstanceDocument): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temp, file)
}

/** Resolve the host credential service, which may activate after this plugin. */
function resolveCredentials(ctx: PluginContext): CredentialService | undefined {
  // `ctx.credentials` may only be read through `inject`; the credential
  // service is optional here (a profile without it still browses), so ask the
  // registry instead of touching the property.
  try {
    const found = ctx.get?.('credentials')
    if (found && typeof (found as CredentialService).modifyRecord === 'function') return found as CredentialService
  } catch {
    // A service that is not reachable from here is simply absent for now.
  }
  return undefined
}

/** Create the instance store. */
export function createInstanceStore({ ctx, logger, dataDir }: { ctx: PluginContext; logger?: Logger; dataDir?: string }): InstanceStore {
  const dir = dataDir ?? DEFAULT_DIR
  const file = path.join(dir, 'instances.json')
  const document = loadDocument(file)
  /** Last connection check per instance, in memory only. */
  const statuses = new Map<string, InstanceStatus>()

  const log = (level: 'warn' | 'error' | 'info', message: string, detail?: unknown): void => {
    const emit = logger?.[level]
    if (typeof emit !== 'function') return
    try {
      emit.call(logger, message, detail)
    } catch {
      // Diagnostic logging must never break a request.
    }
  }

  const credentials = (): CredentialService | undefined => resolveCredentials(ctx)

  async function readToken(id: string): Promise<TokenPayload | undefined> {
    const service = credentials()
    if (!service || typeof service.readRecord !== 'function') return undefined
    try {
      const record: CredentialRecord | undefined = await service.readRecord(credentialKeyFor(id))
      if (!record || record.kind !== 'pat') return undefined
      const payload = record.payload as TokenPayload | undefined
      if (!payload || typeof payload.token !== 'string' || payload.token === '') return undefined
      return payload
    } catch (error) {
      log('warn', `gitlab-workbench: could not read the credential record of ${id}`, {
        error: (error as Error)?.name ?? String(error),
      })
      return undefined
    }
  }

  async function writeToken(id: string, payload: TokenPayload): Promise<void> {
    const service = credentials()
    if (!service || typeof service.modifyRecord !== 'function') {
      throw Object.assign(new Error('The host credential service is unavailable.'), { code: 'credentials_unavailable' })
    }
    await service.modifyRecord(credentialKeyFor(id), async () => ({ kind: 'pat', payload }))
  }

  async function removeToken(id: string): Promise<void> {
    const service = credentials()
    if (!service || typeof service.deleteRecord !== 'function') return
    try {
      await service.deleteRecord(credentialKeyFor(id))
    } catch (error) {
      log('warn', `gitlab-workbench: could not delete the credential record of ${id}`, {
        error: (error as Error)?.name ?? String(error),
      })
    }
  }

  function list(): Instance[] {
    return document.instances.map((entry) => ({ ...entry }))
  }

  function get(id: string): Instance | undefined {
    const found = document.instances.find((entry) => entry.id === id)
    return found ? { ...found } : undefined
  }

  function add(input: AddInstanceInput): Instance {
    const endpoint = normalizeEndpoint(input.endpoint)
    if (document.instances.some((entry) => entry.endpoint.toLowerCase() === endpoint.toLowerCase())) {
      throw Object.assign(new Error('This instance is already configured.'), { code: 'duplicate_instance' })
    }
    const url = new URL(endpoint)
    const now = new Date().toISOString()
    const instance: Instance = {
      id: `inst-${crypto.randomBytes(4).toString('hex')}`,
      label: String(input.label ?? '').trim() || url.host,
      endpoint,
      verifyTls: input.verifyTls !== false,
      ...(typeof input.caPem === 'string' && input.caPem.trim() !== '' ? { caPem: input.caPem.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    }
    document.instances.push(instance)
    saveDocument(file, document)
    return { ...instance }
  }

  async function update(id: string, patch: UpdateInstanceInput): Promise<Instance> {
    const instance = document.instances.find((entry) => entry.id === id)
    if (!instance) throw Object.assign(new Error('Unknown instance.'), { code: 'unknown_instance', status: 404 })
    if (patch.endpoint !== undefined) {
      const endpoint = normalizeEndpoint(patch.endpoint)
      if (document.instances.some((entry) => entry.id !== id && entry.endpoint.toLowerCase() === endpoint.toLowerCase())) {
        throw Object.assign(new Error('This instance is already configured.'), { code: 'duplicate_instance' })
      }
      if (endpoint !== instance.endpoint) {
        instance.endpoint = endpoint
        await removeToken(id)
        statuses.delete(id)
      }
    }
    if (patch.label !== undefined) instance.label = String(patch.label).trim() || new URL(instance.endpoint).host
    if (patch.verifyTls !== undefined) instance.verifyTls = patch.verifyTls !== false
    if (patch.caPem !== undefined) {
      const pem = typeof patch.caPem === 'string' ? patch.caPem.trim() : ''
      if (pem === '') delete instance.caPem
      else instance.caPem = pem
    }
    instance.updatedAt = new Date().toISOString()
    saveDocument(file, document)
    return { ...instance }
  }

  async function remove(id: string): Promise<boolean> {
    const index = document.instances.findIndex((entry) => entry.id === id)
    if (index < 0) return false
    document.instances.splice(index, 1)
    saveDocument(file, document)
    statuses.delete(id)
    await removeToken(id)
    return true
  }

  function setStatus(id: string, status: InstanceStatus): void {
    statuses.set(id, { ...status, checkedAt: new Date().toISOString() })
  }

  function getStatus(id: string): InstanceStatus | undefined {
    return statuses.get(id)
  }

  return {
    list,
    get,
    add,
    update,
    remove,
    readToken,
    writeToken,
    removeToken,
    setStatus,
    getStatus,
    hasCredentials: () => credentials() !== undefined,
  }
}

