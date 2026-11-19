/**
 * Repository files: branch selection, directory tree with paging, and a
 * read-only text viewer with the file's metadata.
 */
import { createElement as h, useEffect, useState } from 'react'

import { api } from '../api'
import { I } from '../icons'
import { t } from '../i18n'
import { useAsync } from '../util'
import { Button, Empty, ErrorNote, IconButton, Spinner } from '../ui'

export function FilesTab({
  instanceId,
  projectPath,
  project,
  refName,
}: {
  instanceId: string
  projectPath: string
  project: any
  refName: string
}) {
  const [dir, setDir] = useState('')
  const [file, setFile] = useState<string | null>(null)
  const [more, setMore] = useState<any[]>([])
  const [moreBusy, setMoreBusy] = useState(false)
  const ref = refName

  const tree = useAsync(
    () => api('tree', { query: { id: instanceId, path: projectPath, dir, ref } }),
    [instanceId, projectPath, dir, ref],
  )
  const fileData = useAsync(
    () => (file ? api('file', { query: { id: instanceId, path: projectPath, filePath: file, ref } }) : Promise.resolve(null)),
    [instanceId, projectPath, file, ref],
  )

  useEffect(() => {
    setMore([])
  }, [dir, ref, projectPath])

  const entries = [...(tree.data?.items ?? []), ...more]
  const nextPage = tree.data?.nextPage ?? null

  const loadMore = async () => {
    if (!nextPage || moreBusy) return
    setMoreBusy(true)
    try {
      const page = await api('tree', { query: { id: instanceId, path: projectPath, dir, ref, page: nextPage } })
      setMore((current) => [...current, ...(page.items ?? [])])
    } finally {
      setMoreBusy(false)
    }
  }

  if (file) {
    const size = typeof fileData.data?.size === 'number' ? fileData.data.size : null
    const humanSize = size === null
      ? ''
      : size < 1024
        ? `${size} B`
        : size < 1024 * 1024
          ? `${(size / 1024).toFixed(1)} KB`
          : `${(size / (1024 * 1024)).toFixed(1)} MB`
    return h(
      'div',
      { className: 'gw-content' },
      h(
        'div',
        { className: 'gw-breadcrumbs' },
        h(IconButton, { label: t('back'), onClick: () => setFile(null) }, h(I.chevron, { size: 14, style: { transform: 'rotate(180deg)' } })),
        h('span', { className: 'gw-mono gw-filepath' }, file),
        h('span', { className: 'gw-top-spacer' }),
        h('span', { className: 'gw-chip mono' }, ref || t('defaultBranch')),
        humanSize ? h('span', { className: 'gw-chip' }, humanSize) : null,
        project.web_url
          ? h(
              'a',
              {
                className: 'gw-btn is-ghost is-sm',
                href: `${project.web_url}/-/blob/${encodeURIComponent(ref)}/${file.split('/').map(encodeURIComponent).join('/')}`,
                target: '_blank',
                rel: 'noreferrer noopener',
              },
              t('openInGitLab'),
              h(I.external, { size: 12 }),
            )
          : null,
      ),
      h(ErrorNote, { error: fileData.error, onRetry: fileData.reload }),
      fileData.loading ? h(Spinner) : null,
      fileData.data
        ? fileData.data.binary
          ? h(Empty, { title: t('binaryFile'), icon: h(I.file, { size: 18 }) })
          : h(
              'div',
              null,
              fileData.data.truncated ? h('div', { className: 'gw-note' }, t('truncated')) : null,
              h('pre', { className: 'gw-file-content' }, fileData.data.content),
            )
        : null,
    )
  }

  const parts = dir === '' ? [] : dir.split('/')

  return h(
    'div',
    { className: 'gw-content' },
    h(
      'div',
      { className: 'gw-breadcrumbs' },
      h('button', { type: 'button', className: 'gw-crumb', onClick: () => setDir('') }, project.name || projectPath),
      parts.map((part, index) =>
        h(
          'span',
          { key: `${part}-${index}`, className: 'gw-crumb-wrap' },
          h(I.chevron, { size: 12 }),
          h('button', { type: 'button', className: 'gw-crumb', onClick: () => setDir(parts.slice(0, index + 1).join('/')) }, part),
        ),
      ),
      h('span', { className: 'gw-top-spacer' }),
      h(IconButton, { label: t('refresh'), onClick: tree.reload }, h(I.refresh, { size: 15 })),
    ),
    h(
      'div',
      { className: 'gw-tree-meta' },
      h('span', null, t('items', { count: entries.length })),
      h('span', { className: 'gw-mono' }, ref),
    ),
    h(ErrorNote, { error: tree.error, onRetry: tree.reload }),
    tree.loading && !tree.data ? h(Spinner) : null,
    tree.data && entries.length === 0 ? h('div', { className: 'gw-muted' }, t('emptyDir')) : null,
    entries.length > 0
      ? h(
          'div',
          { className: 'gw-tree' },
          [...entries]
            .sort((a: any, b: any) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'tree' ? -1 : 1))
            .map((entry: any) =>
              h(
                'button',
                {
                  key: entry.id ?? entry.path,
                  type: 'button',
                  className: 'gw-tree-row',
                  onClick: () => (entry.type === 'tree' ? setDir(entry.path) : setFile(entry.path)),
                },
                entry.type === 'tree' ? h(I.folder, { size: 15 }) : h(I.file, { size: 15 }),
                h('span', { className: 'gw-tree-name' }, entry.name),
                entry.type === 'tree' ? h(I.chevron, { size: 13 }) : null,
              ),
            ),
        )
      : null,
    nextPage
      ? h(
          'div',
          { className: 'gw-tree-more' },
          h(Button, { kind: 'ghost', onClick: loadMore, disabled: moreBusy }, moreBusy ? t('loading') : t('loadMore')),
        )
      : null,
  )
}
