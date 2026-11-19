/**
 * The shapes the host half depends on. They are deliberately structural:
 * the plugin resolves the running Harness's services at runtime and does not
 * import any Harness package, so an installation upgrade cannot break a
 * type-level import.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface Logger {
  info?: (message: string, detail?: unknown) => void
  warn?: (message: string, detail?: unknown) => void
  error?: (message: string, detail?: unknown) => void
  debug?: (message: string, detail?: unknown) => void
}

export interface CredentialRecord {
  kind?: string
  payload?: unknown
  [key: string]: unknown
}

export interface CredentialService {
  readRecord(key: string): Promise<CredentialRecord | undefined>
  modifyRecord(
    key: string,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined> | CredentialRecord | undefined,
  ): Promise<CredentialRecord | undefined>
  deleteRecord(key: string): Promise<void>
}

export interface WebServerRoute {
  kind: 'prefix' | 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

export interface ConnectionService {
  requestRejection?(req: IncomingMessage): number | undefined
}

export interface PluginContext {
  logger?: Logger
  webServer: { register(route: WebServerRoute): () => void }
  connection?: ConnectionService
  credentials?: CredentialService
  get?(name: string): unknown
  effect?(callback: () => void | (() => void), label?: string): void
}

export interface Instance {
  id: string
  label: string
  endpoint: string
  verifyTls: boolean
  caPem?: string
  createdAt: string
  updatedAt: string
}

export interface TokenPayload {
  token: string
  username: string
  name: string
  avatarUrl: string
  webUrl: string
  updatedAt: string
}

export interface UserSummary {
  username: string
  name: string
  avatarUrl: string
  webUrl: string
}

export interface InstanceStatus {
  ok: boolean | null
  user?: UserSummary
  version?: string
  error?: { code: string; message: string; status?: number }
  checkedAt?: string
}

export interface InstanceView {
  id: string
  label: string
  endpoint: string
  verifyTls: boolean
  hasCaPem: boolean
  hasToken: boolean
  tokenUsername: string
  status: InstanceStatus
  createdAt: string
  updatedAt: string
}

export interface GitLabPage<T = unknown> {
  items: T[]
  total: number | null
  page: number
  nextPage: number | null
}
