/**
 * Instances and tokens: the list on the left, the selected instance's form on
 * the right, and a draft for a new instance.
 */
import { createElement as h, useEffect, useState } from 'react'

import { api } from '../api'
import { I } from '../icons'
import { t } from '../i18n'
import { Button, Dot, ErrorNote, Status } from '../ui'
import type { InstanceInfo } from '../types'

interface FormState {
  label: string
  endpoint: string
  token: string
  verifyTls: boolean
  caPem: string
}

const EMPTY_FORM: FormState = { label: '', endpoint: '', token: '', verifyTls: true, caPem: '' }

/**
 * The instance's personal-access-token page. The link follows the URL being
 * typed, so it works before the instance is saved; an invalid or empty URL
 * hides it.
 */
function tokenPageUrl(endpoint: string): string | null {
  const text = endpoint.trim()
  if (text === '') return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const base = `${url.origin}${url.pathname}`.replace(/\/+$/, '').replace(/\/api\/v4$/i, '')
  return `${base}/-/user_settings/personal_access_tokens`
}

export interface SettingsViewProps {
  instances: InstanceInfo[]
  reload: () => void
  onBack: () => void
  initialInstanceId?: string
  startNew?: boolean
}

export function SettingsView({ instances, reload, onBack, initialInstanceId, startNew }: SettingsViewProps) {
  const [selectedId, setSelectedId] = useState(initialInstanceId || instances[0]?.id || '')
  const [previousId, setPreviousId] = useState(initialInstanceId || instances[0]?.id || '')
  const [draft, setDraft] = useState<boolean>(Boolean(startNew) || instances.length === 0)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<any>(null)
  const [tokenOpen, setTokenOpen] = useState(false)

  const selected = instances.find((instance) => instance.id === selectedId) ?? null

  /**
   * When the host no longer knows the selected instance (removed elsewhere, or
   * the store changed under a stale page), turn the form into a fresh "new
   * instance" draft with the values the user already typed.
   */
  const recoverIfGone = (failure: any): boolean => {
    if (failure?.code !== 'unknown_instance') return false
    setDraft(true)
    setSelectedId('')
    setError(Object.assign(new Error(t('instanceGone')), { code: 'instance_gone' }))
    reload()
    return true
  }

  useEffect(() => {
    if (!selected && instances.length > 0 && !draft) setSelectedId(instances[0].id)
  }, [instances, selected, draft])

  useEffect(() => {
    if (instances.length === 0 && !draft) {
      setDraft(true)
      setForm(EMPTY_FORM)
      setSelectedId('')
    }
  }, [instances.length, draft])

  useEffect(() => {
    if (!selected) return
    setForm({
      label: selected.label || '',
      endpoint: selected.endpoint,
      token: '',
      verifyTls: selected.verifyTls !== false,
      caPem: '',
    })
    setTokenOpen(!selected.hasToken)
  }, [selectedId, selected?.endpoint, selected?.label, selected?.verifyTls])

  const startDraft = () => {
    setPreviousId(selectedId)
    setDraft(true)
    setForm(EMPTY_FORM)
    setTokenOpen(true)
    setSelectedId('')
    setError(null)
  }

  const cancelDraft = () => {
    setDraft(false)
    setError(null)
    const fallback = instances.some((instance) => instance.id === previousId) ? previousId : instances[0]?.id ?? ''
    if (fallback === '') {
      setSelectedId('')
      onBack()
      return
    }
    setSelectedId(fallback)
  }

  const saveDraft = async () => {
    setError(null)
    if (form.token.trim() === '') {
      setError(Object.assign(new Error(t('tokenRequired')), { code: 'token_required' }))
      return
    }
    setBusy('save')
    let created: InstanceInfo | null = null
    try {
      created = await api<InstanceInfo>('instances/add', {
        method: 'POST',
        body: { label: form.label, endpoint: form.endpoint, verifyTls: form.verifyTls, caPem: form.caPem },
      })
      await api('instances/token', { method: 'POST', body: { id: created.id, token: form.token.trim() } })
      setDraft(false)
      setSelectedId(created.id)
      reload()
      onBack()
    } catch (failure) {
      // A token that GitLab rejects must not leave a half-configured instance
      // behind: remove the row we just created, then show the failure.
      if (created) {
        try {
          await api('instances/remove', { method: 'POST', body: { id: created.id } })
        } catch {
          // The instance list still refreshes; the user can remove it manually.
        }
        reload()
      }
      setError(failure)
    } finally {
      setBusy('')
    }
  }

  const saveToken = async () => {
    if (!selected) return
    setBusy('token')
    setError(null)
    try {
      await api('instances/token', { method: 'POST', body: { id: selected.id, token: form.token.trim() } })
      setForm((current) => ({ ...current, token: '' }))
      setTokenOpen(false)
      reload()
    } catch (failure) {
      if (!recoverIfGone(failure)) setError(failure)
    } finally {
      setBusy('')
    }
  }

  const saveChanges = async () => {
    if (!selected) return
    setBusy('save')
    setError(null)
    try {
      await api('instances/update', {
        method: 'POST',
        body: { id: selected.id, label: form.label, endpoint: form.endpoint, verifyTls: form.verifyTls, caPem: form.caPem },
      })
      reload()
    } catch (failure) {
      if (!recoverIfGone(failure)) setError(failure)
    } finally {
      setBusy('')
    }
  }

  const testConnection = async () => {
    if (!selected) return
    setBusy('test')
    setError(null)
    try {
      await api('instances/test', { method: 'POST', body: { id: selected.id } })
      reload()
    } catch (failure) {
      if (!recoverIfGone(failure)) setError(failure)
    } finally {
      setBusy('')
    }
  }

  const removeInstance = async () => {
    if (!selected) return
    if (!window.confirm(t('removeConfirm'))) return
    setBusy('remove')
    setError(null)
    try {
      await api('instances/remove', { method: 'POST', body: { id: selected.id } })
      setSelectedId('')
      reload()
    } catch (failure) {
      if (!recoverIfGone(failure)) setError(failure)
    } finally {
      setBusy('')
    }
  }

  const title = draft ? t('newInstance') : selected ? selected.label : t('addInstance')
  const tokenUrl = tokenPageUrl(form.endpoint)

  return h(
    'div',
    { className: 'gw-settings' },
    h(
      'aside',
      { className: 'gw-set-rail' },
      h('div', { className: 'gw-rail-head' }, h('span', null, t('settings')), h('span', { className: 'gw-count' }, String(instances.length))),
      h(
        'div',
        { className: 'gw-set-list' },
        instances.map((instance) =>
          h(
            'button',
            {
              key: instance.id,
              type: 'button',
              className: `gw-inst${!draft && instance.id === selectedId ? ' is-active' : ''}`,
              onClick: () => {
                setDraft(false)
                setSelectedId(instance.id)
                setError(null)
              },
            },
            h('span', { className: 'gw-inst-name' }, h(Dot, { tone: instance.status?.ok === false ? 'bad' : instance.hasToken ? 'ok' : 'idle' }), instance.label || instance.endpoint),
            h('span', { className: 'gw-inst-url' }, instance.endpoint),
          ),
        ),
      ),
      h('div', { className: 'gw-set-foot' }, h(Button, { onClick: startDraft }, h(I.plus, { size: 13 }), t('addInstance'))),
    ),
    h(
      'main',
      { className: 'gw-set-main' },
      h(
        'button',
        { type: 'button', className: 'gw-btn is-ghost', onClick: onBack, style: { marginBottom: 10 } },
        h(I.chevron, { size: 13, style: { transform: 'rotate(180deg)' } }),
        t('backToWorkbench'),
      ),
      h(
        'div',
        { className: 'gw-set-title' },
        h('h2', null, title),
        !draft && selected
          ? h(Status, {
              status: selected.status?.ok ? 'success' : 'idle',
              label: selected.status?.ok ? t('connected') : selected.hasToken ? t('connected') : t('tokenMissing'),
            })
          : null,
        !draft && selected?.status?.version ? h('span', { className: 'gw-chip mono' }, t('versionLabel', { version: selected.status.version })) : null,
      ),
      !draft && selected
        ? h(
            'p',
            { className: 'gw-set-sub' },
            selected.endpoint.replace(/^https?:\/\//, ''),
            selected.status?.user?.username ? ` · ${t('loggedInAs', { name: selected.status.user.username })}` : '',
          )
        : null,
      h(ErrorNote, { error }),
      h(
        'form',
        { className: 'gw-form', onSubmit: (event: any) => event.preventDefault() },
        h(
          'div',
          { className: 'gw-field' },
          h('label', { htmlFor: 'gw-name' }, t('instanceLabel')),
          h('input', { id: 'gw-name', className: 'gw-input', value: form.label, onChange: (event: any) => setForm({ ...form, label: event.target.value }), placeholder: 'corp' }),
          h('span', { className: 'hint' }, t('instanceLabelHint')),
        ),
        h(
          'div',
          { className: 'gw-field' },
          h('label', { htmlFor: 'gw-url' }, t('instanceUrl')),
          h('input', { id: 'gw-url', className: 'gw-input', value: form.endpoint, onChange: (event: any) => setForm({ ...form, endpoint: event.target.value }), placeholder: 'https://gitlab.example.com', inputMode: 'url' }),
          h('span', { className: 'hint' }, t('instanceUrlHint')),
        ),
        h(
          'div',
          { className: 'gw-field' },
          h(
            'div',
            { className: 'gw-field-label-row' },
            h('label', { htmlFor: 'gw-token' }, t('token')),
            tokenUrl
              ? h(
                  'a',
                  { className: 'gw-inline-link', href: tokenUrl, target: '_blank', rel: 'noreferrer noopener' },
                  t('tokenLink'),
                  h(I.external, { size: 11 }),
                )
              : null,
          ),
          tokenOpen || draft
            ? h(
                'div',
                { className: 'gw-inline' },
                h('input', {
                  id: 'gw-token',
                  className: 'gw-input',
                  type: 'password',
                  value: form.token,
                  onChange: (event: any) => setForm({ ...form, token: event.target.value }),
                  placeholder: 'glpat-…',
                  autoComplete: 'off',
                  autoFocus: true,
                }),
                h(Button, { onClick: draft ? saveDraft : saveToken, disabled: Boolean(busy) || form.token.trim() === '' }, busy ? t('saving') : t('saveToken')),
              )
            : h(
                'div',
                { className: 'gw-inline' },
                h('input', { id: 'gw-token', className: 'gw-input', value: selected?.hasToken ? 'glpat-••••••••••••••••' : '', readOnly: true, placeholder: t('tokenMissing') }),
                h(Button, { onClick: () => setTokenOpen(true) }, t('replaceToken')),
              ),
          h('span', { className: 'hint' }, t('tokenHint')),
        ),
        h(
          'div',
          { className: 'gw-switch' },
          h(
            'div',
            { className: 'gw-switch-text' },
            h('div', { className: 'gw-switch-title' }, t('verifyTls')),
            h('div', { className: 'gw-switch-hint' }, t('verifyTlsHint')),
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': form.verifyTls,
            'aria-label': t('verifyTls'),
            className: `gw-toggle${form.verifyTls ? ' is-on' : ''}`,
            onClick: () => setForm({ ...form, verifyTls: !form.verifyTls }),
          }),
        ),
        h(
          'div',
          { className: 'gw-field' },
          h('label', { htmlFor: 'gw-ca' }, t('ca')),
          h('input', { id: 'gw-ca', className: 'gw-input', value: form.caPem, onChange: (event: any) => setForm({ ...form, caPem: event.target.value }), placeholder: '-----BEGIN CERTIFICATE-----' }),
          h('span', { className: 'hint' }, t('caHint')),
        ),
        h(
          'div',
          { className: 'gw-actions' },
          draft
            ? [
                h(Button, { key: 'save', kind: 'primary', onClick: saveDraft, disabled: Boolean(busy) || form.endpoint.trim() === '' }, busy ? t('saving') : t('addInstance')),
                h(Button, { key: 'cancel', kind: 'ghost', onClick: cancelDraft, disabled: Boolean(busy) }, t('cancel')),
              ]
            : [
                h(Button, { key: 'test', onClick: testConnection, disabled: Boolean(busy) || !selected?.hasToken }, busy === 'test' ? t('testing') : t('test')),
                h(Button, { key: 'save', kind: 'primary', onClick: saveChanges, disabled: Boolean(busy) || !selected }, busy === 'save' ? t('saving') : t('saveChanges')),
                h('span', { key: 'end', className: 'end' }),
                h(Button, { key: 'remove', kind: 'danger', onClick: removeInstance, disabled: Boolean(busy) }, h(I.trash, { size: 13 }), t('removeInstance')),
              ],
        ),
      ),
      h('div', { className: 'gw-note' }, h('b', null, `${t('aboutInstancesTitle')}：`), t('aboutInstances')),
    ),
  )
}
