import { useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { WORKSPACE_KEY } from '../state/persistence'
import { prepareImport } from '../api/import'
import { Button, Card } from './ui'
import { useDialog } from './feedback'
import type { RecordData } from '../api/workspace'
import { ApiError } from '../api/client'

export function WorkspaceImport({ onImported }: { onImported: () => Promise<void> }) {
  const { api, user } = useAuth()
  const [source, setSource] = useState(() => { try { return localStorage.getItem(WORKSPACE_KEY) ?? '' } catch { return '' } })
  const [preview, setPreview] = useState<RecordData | null>(null)
  const [replacePreferences, setReplacePreferences] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const locked = useRef(false)
  const ref = useDialog(() => setPreview(null), busy, !!preview)
  const download = () => { const url = URL.createObjectURL(new Blob([source], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'content-hub-browser-backup.json'; link.click(); URL.revokeObjectURL(url) }
  const run = async (commit: boolean) => {
    if (locked.current) return; locked.current = true; setBusy(true); setMessage('')
    let committed = false
    try {
      const payload = prepareImport(source, replacePreferences)
      const result = await api.request<{ data: RecordData }>(`/api/v1/workspace/import${commit ? '' : '/preview'}`, 'POST', payload)
      if (commit) { committed = true; setPreview(null); setMessage('Imported successfully. The server is authoritative; your browser backup was retained.'); await onImported() }
      else { setPreview(result.data); if (result.data.alreadyImported) setMessage('This workspace was already imported into this account. No records were added.') }
    } catch (error) { setMessage(committed ? 'Import succeeded on the server, but refresh failed. Retry loading the server workspace. Reviewing this backup again will show that it was already imported.' : `${error instanceof Error ? error.message : 'Import failed.'} ${error instanceof ApiError ? Object.entries(error.fields).map(([path, message]) => `${path}: ${message}`).join('; ') : ''} Your source backup has been kept. Check server state, correct the backup and retry; failed imports roll back atomically.`) }
    finally { setBusy(false); locked.current = false }
  }
  return <Card className="workspace-import"><details><summary>{source ? 'Browser workspace detected — review migration' : 'Import a previous browser workspace'}</summary><p>Import into <strong>{user?.email}</strong>. Existing server records are never overwritten. Duplicate/conflicting data rejects the entire import. Active browser jobs become cancelled history; overdue schedules need review. Original execution checkpoints remain in your backup.</p><div className="dialog-footer">{source && <Button disabled={busy} onClick={download}>Download original backup</Button>}<label className="field-label">Choose a JSON backup<input type="file" accept="application/json,.json" disabled={busy} onChange={async event => { const file = event.target.files?.[0]; if (file) { if (file.size > 5 * 1024 * 1024) { setMessage('Backup exceeds 5 MB.'); return } try { setSource(await file.text()); setPreview(null); setMessage('') } catch { setMessage('The backup file could not be read. Your original file is unchanged.') } } }} /></label>{source && <Button disabled={busy} onClick={() => void run(false)}>{busy ? 'Checking…' : 'Review import'}</Button>}</div>{message && <p role="status">{message}</p>}</details>{preview && <div className="modal-backdrop"><section ref={ref} tabIndex={-1} className="dialog content-dialog" role="alertdialog" aria-modal="true" aria-label="Confirm workspace import"><h2>Import into {user?.email}?</h2><ul>{Object.entries(preview.counts).map(([key, value]) => <li key={key}>{key}: {String(value)}</li>)}</ul><p>New server IDs preserve relationships. Import is all-or-nothing. Your original local data is retained. Historical work is not resumed automatically.</p><label><input type="checkbox" checked={replacePreferences} disabled={busy} onChange={event => setReplacePreferences(event.target.checked)} /> Also replace my current server preferences with backup preferences</label><div className="dialog-footer"><Button disabled={busy} onClick={() => setPreview(null)}>Cancel</Button><Button variant="primary" disabled={busy || preview.alreadyImported} onClick={() => void run(true)}>{busy ? 'Importing…' : 'Confirm import'}</Button></div>{message && <p role="alert">{message}</p>}</section></div>}</Card>
}
