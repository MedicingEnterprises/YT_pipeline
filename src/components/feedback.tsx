import { Component, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, CircleAlert, LoaderCircle, Trash2, X } from 'lucide-react'
import { Button, ErrorState } from './ui'
import { operationFailure, type OperationResult } from '../state/validation'
import { useStore } from '../state/store'

export function useSubmission() {
  const [result, setResult] = useState<OperationResult | null>(null)
  const [pending, setPending] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  const prefix = useId()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const submit = async (work: () => OperationResult): Promise<OperationResult> => {
    if (locked.current) return { ok: false, kind: 'failure', message: 'This change is already being saved. Please wait.', errors: {} }
    locked.current = true
    setPending(true); setResult(null)
    // Let the browser paint Saving before committing an in-memory operation. No artificial network delay.
    await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    if (!mounted.current) { locked.current = false; return operationFailure() }
    let outcome: OperationResult
    try { outcome = work() } catch { outcome = operationFailure() }
    if (mounted.current) { setResult(outcome); setPending(false) }
    locked.current = false
    return outcome
  }
  const error = (field: string) => result && !result.ok ? result.errors[field] : undefined
  return { result, pending, submit, clear: () => setResult(null), error,
    fieldProps: (field: string) => ({ 'aria-invalid': Boolean(error(field)), 'aria-describedby': error(field) ? `${prefix}-${field}` : undefined, 'data-validation-field': field }),
    errorId: (field: string) => `${prefix}-${field}`,
  }
}
export type Submission = ReturnType<typeof useSubmission>
export function FieldError({ submission, field }: { submission: Submission; field: string }) {
  const message = submission.error(field)
  return message ? <small className="field-error" id={submission.errorId(field)}>{message}</small> : null
}
export function OperationFeedback({ result, pending = false, pendingLabel = 'Saving changes…', onDismiss }: { result: OperationResult | null; pending?: boolean; pendingLabel?: string; onDismiss?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (result && !result.ok && !onDismiss) ref.current?.focus() }, [result, onDismiss])
  if (pending) return <div className="feedback-state" role="status" aria-live="polite"><LoaderCircle size={18} className="spin" />{pendingLabel}</div>
  if (!result) return null
  return <div ref={ref} tabIndex={-1} className={`operation-feedback ${result.ok ? 'operation-success' : 'operation-error'}`} role={result.ok ? 'status' : 'alert'} aria-live={result.ok ? 'polite' : 'assertive'}>
    {result.ok ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
    <div><strong>{result.message}</strong>{!result.ok && Object.keys(result.errors).length > 0 && <ul>{Object.entries(result.errors).map(([field, message]) => <li key={field}>{message}</li>)}</ul>}</div>
    {onDismiss && <Button type="button" variant="ghost" iconOnly icon={<X size={15} />} aria-label="Dismiss message" onClick={onDismiss} />}
  </div>
}

export function useDialog(onClose: () => void, busy: boolean) {
  const ref = useRef<HTMLElement>(null)
  const latest = useRef({ onClose, busy })
  useEffect(() => { latest.current = { onClose, busy } }, [onClose, busy])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const controls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])
    const initialControl = ref.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? controls()[0]
    initialControl?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); if (!latest.current.busy) latest.current.onClose() }
      if (event.key === 'Tab') {
        const items = controls(), first = items[0], last = items.at(-1)
        if (!items.length) { event.preventDefault(); ref.current?.focus(); return }
        if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus() }
  }, [])
  return ref
}

const consequences = {
  channel: 'Its channel settings and pipeline assignments will be removed. Reassign or delete its content first.',
  provider: 'Its pipeline assignments and default provider preferences will be cleared.',
  content: 'Its mock schedules, jobs, analytics rows, and related activity will also be removed.',
  pipeline: 'Content will be kept, but its pipeline links and default pipeline preferences will be cleared.',
  schedule: 'The content item will be kept and its planned date will be cleared.',
}
function DeleteDialog() {
  const { pendingDelete, actions } = useStore()
  const submission = useSubmission()
  const ref = useDialog(actions.cancelDelete, submission.pending)
  if (!pendingDelete) return null
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !submission.pending) actions.cancelDelete() }}><section ref={ref} className="dialog" aria-busy={submission.pending} role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" tabIndex={-1}>
    <div className="dialog-header"><div className="dialog-icon"><Trash2 size={19} /></div><Button variant="ghost" iconOnly icon={<X size={18} />} aria-label="Cancel deletion" onClick={actions.cancelDelete} disabled={submission.pending} /></div>
    <h2 id="delete-title">Delete {pendingDelete.kind}?</h2><p id="delete-description" className="dialog-description"><strong>{pendingDelete.name}</strong> will be deleted. {consequences[pendingDelete.kind]} This cannot be undone in this session.</p>
    <OperationFeedback result={submission.result} pending={submission.pending} pendingLabel={`Deleting ${pendingDelete.kind}…`} />
    <div className="dialog-footer"><Button onClick={actions.cancelDelete} disabled={submission.pending}>Keep {pendingDelete.kind}</Button><Button className="button-danger" variant="primary" disabled={submission.pending} onClick={() => { void submission.submit(actions.confirmDelete) }}>{submission.pending ? 'Deleting…' : `Delete ${pendingDelete.kind}`}</Button></div>
  </section></div>
}
export function WorkspaceFeedback() {
  const { notice, actions, pendingDelete } = useStore()
  return <><OperationFeedback result={notice} onDismiss={actions.dismissNotice} />{pendingDelete && <DeleteDialog key={`${pendingDelete.kind}-${pendingDelete.id}`} />}</>
}

export class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <ErrorState title="This view could not be displayed" description="Your saved workspace data is safe. Try opening the view again." onRetry={() => this.setState({ failed: false })} />
    return this.props.children
  }
}
