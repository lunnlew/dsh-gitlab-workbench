/**
 * Types of the values the host returns. GitLab payloads are passed through
 * mostly untouched, so the deep shapes stay permissive; the envelope the host
 * normalizes is typed.
 */
export interface InstanceStatusInfo {
  ok: boolean | null
  user?: { username: string; name: string; avatarUrl: string; webUrl: string }
  version?: string
  error?: { code: string; message: string; status?: number }
  checkedAt?: string
}

export interface InstanceInfo {
  id: string
  label: string
  endpoint: string
  verifyTls: boolean
  hasCaPem: boolean
  hasToken: boolean
  tokenUsername: string
  status: InstanceStatusInfo
  createdAt: string
  updatedAt: string
}

export interface Page<T = any> {
  items: T[]
  total: number | null
  page: number
  nextPage: number | null
  /** Set when GitLab refuses the pipelines endpoint because the project has none. */
  ciDisabled?: boolean
  reason?: 'ci_disabled' | 'empty_repo'
}

export interface ProjectDetailResponse {
  project: any
  openMergeRequests: number | null
}

export interface PipelineResponse {
  pipeline: any
  jobs: any[]
}

export interface FileResponse {
  filePath: string
  ref: string
  binary: boolean
  size: number
  truncated: boolean
  content: string
}

export interface TraceResponse {
  jobId: string
  content: string
  truncated: boolean
  size: number
}
