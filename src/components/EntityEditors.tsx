import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { Button, EmptyState, Select } from './ui'
import { FieldError, OperationFeedback, useDialog, useSubmission, type Submission } from './feedback'
import { useStore } from '../state/store'
import { canTransition, contentStatuses, isPipelineAvailable, validationError, type OperationResult, wallTimeNow } from '../state/validation'
import type { Channel, ContentItem, ScheduledVideo } from '../models'
import { scheduleMode } from '../execution/queue'
import { suggestedScheduleMode } from '../state/selectors'

const stamp = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const missingItem = (): OperationResult => ({ ok: false, kind: 'failure', message: 'This item is no longer available. Close the form and choose another item.', errors: {} })
function Field({ label, field, submission, children }: { label: string; field: string; submission: Submission; children: ReactNode }) {
  return <label className="field-label">{label}{children}<FieldError submission={submission} field={field} /></label>
}
export function Editor({ title, onClose, onSave, onSuccess, children }: { title: string; onClose: () => void; onSave: () => OperationResult | Promise<OperationResult>; onSuccess?: () => void; children: (submission: Submission) => ReactNode }) {
  const { remote } = useStore()
  const submission = useSubmission()
  const ref = useDialog(onClose, submission.pending)
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !submission.pending) onClose() }}><section ref={ref} className="dialog content-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
    <div className="dialog-header"><h2>{title}</h2><Button type="button" variant="ghost" iconOnly icon={<X size={18} />} aria-label="Close editor" onClick={onClose} disabled={submission.pending} /></div>
    <form noValidate aria-busy={submission.pending} onChange={submission.clear} onSubmit={event => { event.preventDefault(); void submission.submit(onSave).then(result => { if (result.ok) { onClose(); onSuccess?.() } }) }}>
      <OperationFeedback result={submission.result} pending={submission.pending} />
      <fieldset className="editor-fields" disabled={submission.pending}>{children(submission)}</fieldset>
      <div className="dialog-footer"><Button type="button" onClick={onClose} disabled={submission.pending}>Cancel</Button><Button type="submit" variant="primary" disabled={submission.pending}>{submission.pending ? 'Saving…' : 'Save changes'}</Button></div>
    </form><p className="dialog-note">{remote ? 'Changes are saved to your authenticated backend account. Media operations remain mock only.' : 'Mock workspace only. Changes are saved in this browser when storage is available.'}</p>
  </section></div>
}
function channelTime(value: string) {
  if (/^\d{2}:\d{2}$/.test(value)) return value
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  return match ? `${String(Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[2]}` : ''
}
export function ChannelEditor({ channelId, onClose }: { channelId?: string; onClose: () => void }) {
  const { state, actions } = useStore()
  const existing = channelId ? state.channels.get(channelId) : undefined
  const [draft, setDraft] = useState<Channel>(() => existing ? { ...existing, scheduleTime: channelTime(existing.scheduleTime), scheduleDays: existing.scheduleDays === 'Not set' ? '' : existing.scheduleDays } : { id: channelId ?? id(), name: '', handle: '', category: '', subscribers: '0', videos: '0', initials: '', color: 'channel-purple', status: 'disconnected', recentActivity: 'Channel created', activityTime: 'Just now', scheduleDays: '', scheduleTime: '09:30', scheduledCount: 0, publishedCount: 0, defaultPipelineId: null, recentUploads: [], createdAt: stamp(), updatedAt: stamp() })
  return <Editor title={channelId ? 'Edit channel settings' : 'Create channel'} onClose={onClose} onSave={() => {
    if (channelId && !state.channels.has(channelId)) return missingItem()
    const value = { ...draft, name: draft.name.trim(), handle: draft.handle.trim(), initials: draft.name.trim().split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase() }
    return channelId ? actions.updateChannel(channelId, value) : actions.addChannel(value)
  }}>{submission => <>
    <Field label="Channel name" field="name" submission={submission}><input {...submission.fieldProps('name')} className="text-input" required maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
    <Field label="Handle" field="handle" submission={submission}><input {...submission.fieldProps('handle')} className="text-input" required placeholder="@channel" value={draft.handle} onChange={e => setDraft({ ...draft, handle: e.target.value })} /></Field>
    <Field label="Category" field="category" submission={submission}><input {...submission.fieldProps('category')} className="text-input" maxLength={80} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></Field>
    <Field label="Connection status" field="status" submission={submission}><Select {...submission.fieldProps('status')} className="select-full" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Channel['status'] })}><option value="connected">Mock connected</option><option value="disconnected">Disconnected</option></Select></Field>
    <Field label="Publishing days" field="scheduleDays" submission={submission}><input {...submission.fieldProps('scheduleDays')} className="text-input" placeholder="Monday, Wednesday" value={draft.scheduleDays} onChange={e => setDraft({ ...draft, scheduleDays: e.target.value })} /></Field>
    <Field label="Preferred time" field="scheduleTime" submission={submission}><input {...submission.fieldProps('scheduleTime')} className="text-input" type="time" value={draft.scheduleTime} onChange={e => setDraft({ ...draft, scheduleTime: e.target.value })} /></Field>
    <Field label="Default pipeline" field="defaultPipelineId" submission={submission}><Select {...submission.fieldProps('defaultPipelineId')} className="select-full" value={draft.defaultPipelineId ?? ''} onChange={e => setDraft({ ...draft, defaultPipelineId: e.target.value || null })}><option value="">None</option>{Array.from(state.pipelines.values()).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
  </>}</Editor>
}
export function ContentEditor({ contentId, onClose, onSaved }: { contentId?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { state, actions, remote } = useStore()
  const savedId = useRef(contentId)
  const existing = contentId ? state.content.get(contentId) : undefined
  const [draft, setDraft] = useState<ContentItem>(() => existing ?? { id: contentId ?? id(), title: '', channelId: state.channels.has(state.preferences?.defaultChannelId ?? '') ? state.preferences!.defaultChannelId! : '', pipelineId: isPipelineAvailable(state, state.preferences?.defaultPipelineId ?? '') ? state.preferences!.defaultPipelineId! : '', status: 'Idea', visibility: state.preferences?.defaultVisibility ?? 'private', createdAt: stamp(), updatedAt: stamp(), scheduledAt: '', format: 'Long-form video', publishPreference: 'Decide later', notes: '', thumbnail: 'thumb-creative' })
  const scheduleRequired = draft.status === 'Scheduled' || draft.publishPreference === 'Schedule for a date'
  const schedulable = existing && (existing.status === 'Ready' || existing.status === 'Scheduled')
  const setStatus = (status: ContentItem['status']) => setDraft(current => ({ ...current, status,
    ...(['Idea', 'Script'].includes(status) ? { scheduledAt: '', publishPreference: 'Decide later' as const } : status === 'Published' ? { scheduledAt: '', publishPreference: 'Publish manually when ready' as const } : status === 'Ready' && existing?.status === 'Scheduled' ? { scheduledAt: '', publishPreference: 'Decide later' as const } : status === 'Scheduled' ? { publishPreference: 'Schedule for a date' as const } : {}),
  }))
  return <Editor title={contentId ? 'Edit content' : 'Create content'} onClose={onClose} onSuccess={() => onSaved?.(savedId.current ?? draft.id)} onSave={async () => {
    if (contentId && !state.content.has(contentId)) return missingItem()
    const value = { ...draft, title: draft.title.trim() }
    const result = await (contentId ? actions.updateContent(contentId, value) : actions.addContent(value))
    if (result.ok) savedId.current = result.entityId ?? draft.id
    return result
  }}>{submission => <>
    {!state.channels.size && <EmptyState icon={<X size={18} />} title="Add a channel first" description="Content needs a channel before it can be saved." action={<Link className="text-link" to="/channels" onClick={onClose}>Open channels</Link>} />}
    <p className="dialog-note">Choose a channel and pipeline for this idea. Mock providers are assigned to steps in <Link to="/pipelines" onClick={onClose}>Pipelines</Link>; configure them in <Link to="/providers" onClick={onClose}>AI Providers</Link>. After saving, Content Details guides execution and scheduling.</p>
    {!Array.from(state.pipelines.values()).some(p => isPipelineAvailable(state, p.id)) && <p className="disabled-action-note">Create or enable a pipeline before saving new content.</p>}
    <Field label="Topic or idea" field="title" submission={submission}><input {...submission.fieldProps('title')} className="text-input" required maxLength={120} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></Field>
    <Field label="Channel" field="channelId" submission={submission}><Select {...submission.fieldProps('channelId')} required className="select-full" value={draft.channelId} onChange={e => setDraft({ ...draft, channelId: e.target.value })}><option value="">Choose a channel</option>{Array.from(state.channels.values()).map(c => <option key={c.id} value={c.id}>{c.name}{c.status !== 'connected' ? ' (disconnected)' : ''}</option>)}</Select></Field>
    <Field label="Pipeline" field="pipelineId" submission={submission}><Select {...submission.fieldProps('pipelineId')} required className="select-full" value={draft.pipelineId} onChange={e => setDraft({ ...draft, pipelineId: e.target.value })}><option value="">Choose a pipeline</option>{Array.from(state.pipelines.values()).map(p => <option key={p.id} value={p.id} disabled={!isPipelineAvailable(state, p.id) && p.id !== existing?.pipelineId}>{p.name}{!p.enabled ? ' (disabled)' : !isPipelineAvailable(state, p.id) ? ' (needs attention)' : ''}</option>)}</Select></Field>
    <Field label="Status" field="status" submission={submission}><Select {...submission.fieldProps('status')} className="select-full" value={draft.status} onChange={e => setStatus(e.target.value as ContentItem['status'])}>{contentStatuses.map(s => <option key={s} disabled={remote && s === 'Scheduled' && existing?.status !== 'Scheduled' || (existing ? !canTransition(existing.status, s) : s !== 'Idea')}>{s}</option>)}</Select></Field>
    <p className="disabled-action-note">{existing?.status === 'Published' ? 'Published content stays published. Create a new item to start another version.' : !existing ? 'New content starts as an Idea. Save it before moving to the next stage.' : 'Only the next available stages can be selected. Mark a failed item for review before retrying.'}</p>
    <Field label="Format" field="format" submission={submission}><Select {...submission.fieldProps('format')} className="select-full" value={draft.format} onChange={e => setDraft({ ...draft, format: e.target.value as ContentItem['format'] })}>{['Long-form video', 'YouTube Short', 'Explainer', 'Interview'].map(s => <option key={s}>{s}</option>)}</Select></Field>
    <Field label="Publishing preference" field="publishPreference" submission={submission}><Select {...submission.fieldProps('publishPreference')} disabled={remote && existing?.status === 'Scheduled'} className="select-full" value={draft.publishPreference} onChange={e => setDraft({ ...draft, publishPreference: e.target.value as ContentItem['publishPreference'], status: e.target.value === 'Schedule for a date' ? 'Scheduled' : draft.status === 'Scheduled' ? 'Ready' : draft.status, scheduledAt: e.target.value === 'Schedule for a date' ? draft.scheduledAt || `${wallTimeNow(state.preferences?.timezone ?? 'UTC').slice(0, 10)}T${state.preferences?.defaultPublishTime ?? '09:30'}` : '' })}>{['Decide later', 'Publish manually when ready', 'Schedule for a date'].map(s => <option key={s} disabled={s === 'Schedule for a date' && (!schedulable || remote)}>{s}</option>)}</Select></Field>
    {remote && <p className="dialog-note">Use Schedule ready content or Scheduler to create, change or cancel a schedule.</p>}
    {scheduleRequired && <Field label={`Scheduled date and time (${state.preferences?.timezone ?? 'UTC'})`} field="scheduledAt" submission={submission}><input {...submission.fieldProps('scheduledAt')} className="text-input" type="datetime-local" required disabled={remote} value={draft.scheduledAt} onChange={e => setDraft({ ...draft, scheduledAt: e.target.value })} /></Field>}
    <Field label="Visibility" field="visibility" submission={submission}><Select {...submission.fieldProps('visibility')} className="select-full" value={draft.visibility ?? 'private'} onChange={e => setDraft({ ...draft, visibility: e.target.value as ContentItem['visibility'] })}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></Select></Field>
    <Field label="Notes" field="notes" submission={submission}><textarea {...submission.fieldProps('notes')} className="text-input" rows={3} maxLength={2000} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></Field>
  </>}</Editor>
}
export function ScheduleEditor({ scheduleId, initialContentId, onClose }: { scheduleId?: string; initialContentId?: string; onClose: () => void }) {
  const { state, actions, remote } = useStore()
  const existing = scheduleId ? state.scheduledVideos.get(scheduleId) : undefined
  const [contentId, setContentId] = useState(existing?.contentId ?? initialContentId ?? '')
  const [scheduledAt, setScheduledAt] = useState(existing?.scheduledAt ?? '')
  const [status, setStatus] = useState<ScheduledVideo['status']>(existing?.status ?? 'Scheduled')
  const [executionMode, setExecutionMode] = useState<ScheduledVideo['executionMode']>(existing ? scheduleMode(state, existing) : suggestedScheduleMode(state, initialContentId ?? ''))
  const available = Array.from(state.content.values()).filter(c => c.status !== 'Published' && (c.id === existing?.contentId || c.status === 'Ready' && !Array.from(state.scheduledVideos.values()).some(s => s.contentId === c.id)))
  const selected = state.content.get(contentId)
  const targetStatus = { Scheduled: 'Scheduled', Ready: 'Ready', Processing: 'Generating', 'Needs attention': 'Failed' } as const
  return <Editor title={scheduleId ? 'Edit mock schedule' : 'Create mock schedule'} onClose={onClose} onSave={() => {
    if (scheduleId && !state.scheduledVideos.has(scheduleId)) return missingItem()
    const item = state.content.get(contentId)
    if (!item) return validationError({ contentId: 'Choose an available content item.' })
    const value: ScheduledVideo = { id: existing?.id ?? scheduleId ?? id(), executionMode, contentId, title: item.title, thumbnail: item.thumbnail, channelId: item.channelId, pipelineId: item.pipelineId, scheduledAt, status, createdAt: existing?.createdAt ?? stamp(), updatedAt: stamp() }
    return scheduleId ? actions.updateScheduledVideo(scheduleId, value) : actions.addScheduledVideo(value)
  }}>{submission => <>
    {!available.length && <p className="disabled-action-note">No content is ready to schedule. Move a content item to Ready first, or edit its existing schedule.</p>}
    <Field label="Content item" field="contentId" submission={submission}><Select {...submission.fieldProps('contentId')} required className="select-full" value={contentId} onChange={e => { setContentId(e.target.value); if (!existing) setExecutionMode(suggestedScheduleMode(state, e.target.value)) }}><option value="">Choose content</option>{available.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
    <Field label="Scheduled action" field="executionMode" submission={submission}><Select value={executionMode} onChange={event => setExecutionMode(event.target.value as ScheduledVideo['executionMode'])}><option value="pipeline">Run pipeline, then mock-publish</option><option value="publication">Mock-publish prepared content only</option></Select></Field>
    {selected && (!selected.channelId || !selected.pipelineId) && <p className="disabled-action-note">Open this item in Content and choose a channel and pipeline before scheduling it.</p>}
    <Field label={`Date and time (${state.preferences?.timezone ?? 'UTC'})`} field="scheduledAt" submission={submission}><input {...submission.fieldProps('scheduledAt')} className="text-input" required type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} /></Field>
    <p className="disabled-action-note">Schedule status follows the content stages. Return failed content to Ready before scheduling it again.</p>
    <Field label="Schedule status" field="status" submission={submission}><Select {...submission.fieldProps('status')} disabled={remote} className="select-full" value={status} onChange={e => setStatus(e.target.value as ScheduledVideo['status'])}>{(['Scheduled', 'Ready', 'Processing', 'Needs attention'] as const).map(s => <option key={s} disabled={Boolean(selected && !canTransition(selected.status, targetStatus[s]))}>{s}</option>)}</Select></Field>
  </>}</Editor>
}
