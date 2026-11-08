import {
  AlertTriangle,
  Activity,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CirclePlay,
  Clock3,
  Eye,
  Image,
  KeyRound,
  Lightbulb,
  LockKeyhole,
  Mail,
  Mic2,
  Monitor,
  MoreHorizontal,
  Palette,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Settings2,
  Sparkles,
  Sun,
  ThumbsUp,
  Trash2,
  BrainCircuit,
  Video,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Avatar, Badge, Button, Card, EmptyState, PageHeading, SectionHeading, Select, StatCard } from './components/ui'
import { useStore } from './state/store'
import { useOptionalAuth } from './auth/AuthProvider'
import { ChannelEditor, ContentEditor, ScheduleEditor } from './components/EntityEditors'
import { PipelineExecutionPanel } from './components/PipelineExecution'
import { JobQueuePanel } from './components/JobQueue'
import { PipelineDetailsDialog } from './components/PipelineDetails'
import { canScheduleContent, workspaceCounts } from './state/selectors'
import { calendarDate, calendarKey, formatWallTime, workspaceToday } from './state/time'
import { useChannelRows, useContentRows, usePipelineRows, useScheduledVideoRows, useDashboardData, useAnalyticsRows } from './state/adapters'
import type { UserPreferences } from './models'
import { FieldError, OperationFeedback, useDialog, useSubmission } from './components/feedback'
import { providerTypesForStep, validateProvider, validatePipeline, validationError, type OperationResult } from './state/validation'
import {
  useProviderRows,
  useProviderCategories,
  useModelsByCategory,
} from './state/adapters'

type CreateAction = { onCreate: () => void }

type ProviderCategory = 'Text generation' | 'Text-to-speech' | 'Image generation' | 'Video generation' | 'Embeddings / analysis'

function isProviderCategory(value: string): value is ProviderCategory {
  return providerCategories.includes(value as ProviderCategory)
}

type AIProvider = {
  id: string
  name: string
  category: ProviderCategory
  connected: boolean
  enabled: boolean
  models: string[]
  lastUsed: string
}

type Channel = {
  id: string
  name: string
  handle: string
  category: string
  subscribers: string
  videos: string
  initials: string
  color: string
  connected: boolean
  recentActivity: string
  activityTime: string
  scheduleDays: string
  scheduleTime: string
  scheduledCount: number
  publishedCount: number
  pipeline: string
  recentUploads: { id: string; title: string; status: string; date: string; tone: 'green' | 'blue' | 'amber' }[]
}

type ContentStatus = 'Idea' | 'Script' | 'Generating' | 'Editing' | 'Ready' | 'Scheduled' | 'Published' | 'Failed'

type ContentItem = {
  id: string
  title: string
  channel: string
  pipeline: string
  status: ContentStatus
  createdAt: string
  scheduledAt: string
  format: string
  publishPreference: string
  notes: string
  image: string
}

const contentStatuses: ContentStatus[] = ['Idea', 'Script', 'Generating', 'Editing', 'Ready', 'Scheduled', 'Published', 'Failed']

const contentStatusTone: Record<ContentStatus, 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red'> = {
  Idea: 'neutral',
  Script: 'blue',
  Generating: 'violet',
  Editing: 'amber',
  Ready: 'green',
  Scheduled: 'blue',
  Published: 'green',
  Failed: 'red',
}


const providerCategories: ProviderCategory[] = [
  'Text generation',
  'Text-to-speech',
  'Image generation',
  'Video generation',
  'Embeddings / analysis',
]


type PipelineStepKind = 'Idea' | 'Script' | 'Voice' | 'Visuals' | 'Edit' | 'Captions' | 'Thumbnail' | 'Quality check' | 'Upload' | 'Schedule' | 'Research' | 'Review'

type PipelineStep = {
  id: string
  kind: PipelineStepKind
  enabled: boolean
  config: {
    instructions: string
    providerId: string | null
  }
}

type Pipeline = {
  id: string
  name: string
  description: string
  assignedChannels: string[]
  enabled: boolean
  lastUsed: string
  steps: PipelineStep[]
}

const pipelineStepKinds: PipelineStepKind[] = ['Idea', 'Script', 'Voice', 'Visuals', 'Edit', 'Captions', 'Thumbnail', 'Quality check', 'Upload', 'Schedule', 'Research', 'Review']
const defaultPipelineSteps: PipelineStepKind[] = ['Idea', 'Script', 'Voice', 'Visuals', 'Edit', 'Captions', 'Thumbnail', 'Quality check', 'Upload', 'Schedule']

function createPipelineStep(kind: PipelineStepKind, index: number): PipelineStep {
  return {
    id: `step-${index}-${crypto.randomUUID()}`,
    kind,
    enabled: true,
    config: { instructions: '', providerId: null },
  }
}

function createDefaultSteps(): PipelineStep[] {
  return defaultPipelineSteps.map((kind, index) => createPipelineStep(kind, index))
}

type ScheduleStatus = 'Scheduled' | 'Ready' | 'Processing' | 'Needs attention'

type ScheduledVideo = {
  id: string
  title: string
  thumbnail: string
  channel: string
  pipeline: string
  scheduledAt: string
  status: ScheduleStatus
}

function localDateTime(date: Date, hour: number, minute: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(hour)}:${pad(minute)}`
}

function localDateKey(date: Date): string {
  return localDateTime(date, 0, 0).slice(0, 10)
}

function AddButton({ children, onClick }: { children: string; onClick: () => void }) {
  return <Button variant="primary" icon={<Plus size={16} />} onClick={onClick}>{children}</Button>
}

function VideoThumbnail({ kind, compact = false }: { kind: string; compact?: boolean }) {
  return (
    <div className={`video-thumbnail ${kind}${compact ? ' video-thumbnail-compact' : ''}`}>
      <span className="thumbnail-orb" />
      <span className="thumbnail-caption">{kind === 'thumb-sunrise' ? 'A softer start' : kind === 'thumb-journal' ? 'Make space for you' : kind === 'thumb-creative' ? 'Create without fear' : 'Live a little lighter'}</span>
      <span className="play-button"><CirclePlay size={compact ? 17 : 21} /></span>
    </div>
  )
}

function DashboardPage({ onCreate }: CreateAction) {
  const [activityParams, setActivityParams] = useSearchParams()
  const showActivityHistory = activityParams.get('activity') === 'all'
  const setShowActivityHistory = (update: (value: boolean) => boolean) => setActivityParams(previous => { const next = new URLSearchParams(previous); if (update(showActivityHistory)) next.set('activity', 'all'); else next.delete('activity'); return next }, { replace: true })
  useEffect(() => { if (showActivityHistory) document.getElementById('activity-history')?.scrollIntoView({ block: 'start' }) }, [showActivityHistory])
  const timezone = useStore().state.preferences?.timezone ?? 'UTC'
  const channelRows = useChannelRows()
  const data = useDashboardData()
  const icons = [Video, CalendarDays, Activity, CheckCircle2]
  const tones = ['violet', 'blue', 'amber', 'green'] as const
  const dashboardMockData = { ...data, overview: data.overview.map((item, index) => ({ ...item, icon: icons[index], tone: tones[index] })), recentActivity: data.recentActivity.map(item => ({ ...item, icon: Activity })) }
  const visibleActivity = (showActivityHistory ? data.activityHistory : data.recentActivity).map(item => ({ ...item, icon: Activity }))

  const processingCount = dashboardMockData.pipelineStages.reduce((sum, stage) => sum + stage.jobs, 0)

  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE OVERVIEW · MOCK DATA"
        title="Content at a glance"
        description="A snapshot of videos, pipelines, and channel activity across your workspace."
        action={<AddButton onClick={onCreate}>Create content</AddButton>}
      />

      <div className="stat-grid dashboard-stat-grid">
        {dashboardMockData.overview.map(({ label, value, detail, icon: Icon, tone }) => (
          <StatCard key={label} label={label} value={value} change={detail} changeTone="neutral" icon={<Icon size={18} />} tone={tone} />
        ))}
      </div>

      <div className="system-dashboard-grid">
        <div className="system-dashboard-primary">
          <Card className="system-panel upcoming-panel">
            <SectionHeading title="Upcoming uploads" action={<Link className="text-link" to="/scheduler">Open scheduler <ArrowRight size={14} /></Link>} />
            {dashboardMockData.upcomingUploads.length > 0 ? (
              <div className="upload-list">
                {dashboardMockData.upcomingUploads.map((upload) => (
                  <article className="upload-row" key={upload.title}>
                    <VideoThumbnail kind={upload.thumbnail} compact />
                    <div className="upload-copy">
                      <h3><Link to={`/content?content=${encodeURIComponent(upload.contentId)}`}>{upload.title}</Link></h3>
                      <span>{upload.channel}</span>
                      <time><CalendarDays size={12} />{formatContentDate(upload.scheduledAt, timezone)}</time>
                    </div>
                    <Badge tone={upload.tone} dot>{upload.status}</Badge>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState icon={<CalendarDays size={19} />} title="Nothing scheduled yet" description="When uploads are scheduled, they’ll show up here." action={<Button variant="secondary" onClick={onCreate}>Plan a video</Button>} />
            )}
          </Card>

          <Card className="system-panel pipeline-activity-panel">
            <SectionHeading title="Pipeline activity" action={<Link className="text-link" to="/pipelines">View pipelines <ArrowRight size={14} /></Link>} />
            {dashboardMockData.pipelineStages.length > 0 ? (
              <>
                <div className="pipeline-total"><strong>{processingCount}</strong><span>items across all stages</span><Badge tone="amber" dot>{data.pipelineStages.find(stage => stage.name === 'Processing')?.jobs ?? 0} processing</Badge></div>
                <div className="pipeline-stage-list">
                  {dashboardMockData.pipelineStages.map((stage) => (
                    <div className="pipeline-stage-row" key={stage.name}>
                      <span className="pipeline-stage-name">{stage.name}</span>
                      <div className="stage-track" aria-label={`${stage.jobs} content items in ${stage.name}`}><span className={`stage-fill stage-fill-${stage.color}`} style={{ width: `${processingCount ? (stage.jobs / processingCount) * 100 : 0}%` }} /></div>
                      <strong>{stage.jobs}</strong>
                    </div>
                  ))}
                </div>
                <div className="pipeline-stage-footer"><span><i className="stage-legend stage-legend-processing" />In progress</span><span><i className="stage-legend stage-legend-review" />Needs review</span><span>Updated just now</span></div>
              </>
            ) : (
              <EmptyState icon={<Workflow size={19} />} title="No pipeline activity" description="Jobs will appear here when they enter a pipeline." />
            )}
          </Card>
        </div>

        <div className="system-dashboard-secondary">
          <Card className="system-panel activity-panel" id="activity-history">
            <SectionHeading title={showActivityHistory ? 'Activity history' : 'Recent activity'} action={<Button variant="quiet" onClick={() => setShowActivityHistory(value => !value)}>{showActivityHistory ? 'Show recent activity' : 'View activity history'}</Button>} />
            {visibleActivity.length > 0 ? (
              <div className="system-activity-list">
                {visibleActivity.map(({ id, category, title, detail, time, icon: Icon, tone, relatedContentId }) => (
                  <article className="system-activity-row" key={id}>
                    <span className={`activity-icon ${tone}`}><Icon size={15} /></span>
                    <div className="system-activity-copy">
                      <div><strong>{relatedContentId ? <Link to={`/content?content=${encodeURIComponent(relatedContentId)}`}>{title}</Link> : title}</strong><Badge tone={tone === 'activity-red' ? 'red' : tone === 'activity-amber' ? 'amber' : tone === 'activity-green' ? 'green' : tone === 'activity-blue' ? 'blue' : 'violet'}>{category}</Badge></div>
                      <p>{detail}</p>
                      <time>{time}</time>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Activity size={19} />} title="No recent activity" description="Generation, upload, and scheduling updates will appear here." />
            )}
          </Card>

          <Card className="system-panel channel-overview-panel">
            <SectionHeading title="Channel overview" action={<Link className="text-link" to="/channels">All channels <ArrowRight size={14} /></Link>} />
            {channelRows.length > 0 ? (
              <div className="channel-overview-list">
                {channelRows.map((channel) => (
                  <article className="channel-overview-row" key={channel.name}>
                    <Avatar initials={channel.initials} className={channel.color} />
                    <div className="channel-overview-copy">
                      <strong>{channel.name}</strong>
                      <span>{channel.recentActivity} · {channel.activityTime}</span>
                    </div>
                    <Badge tone={channel.connected ? 'green' : 'neutral'} dot>{channel.connected ? 'Connected' : 'Disconnected'}</Badge>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Radio size={19} />} title="No channels yet" description="Add a channel to see its connection state and recent activity." action={<Link className="text-link" to="/channels">View channels <ArrowRight size={14} /></Link>} />
            )}
          </Card>
        </div>
      </div>
      <JobQueuePanel compact />
    </>
  )
}

function ChannelDetailsDialog({ channel, onClose, onConnect }: { channel: Channel; onClose: () => void; onConnect: () => void }) {
  const ref = useDialog(onClose, false)

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={ref} tabIndex={-1} className="dialog channel-details-dialog" role="dialog" aria-modal="true" aria-labelledby="channel-dialog-title">
        <div className="dialog-header">
          <div className={`channel-details-avatar ${channel.color}`}>{channel.initials}</div>
          <Button variant="ghost" iconOnly icon={<X size={18} />} aria-label="Close channel details" onClick={onClose} />
        </div>
        <div className="channel-details-title-row">
          <div>
            <p className="eyebrow">CHANNEL DETAILS</p>
            <h2 id="channel-dialog-title">{channel.name}</h2>
            <p className="channel-handle">{channel.handle}</p>
          </div>
          <Badge tone={channel.connected ? 'green' : 'neutral'} dot>{channel.connected ? 'Connected' : 'Disconnected'}</Badge>
        </div>
        {!channel.connected && (
          <div className="channel-disconnected-note">
            <Radio size={16} />
            <span>This channel is a mock entry and isn’t connected to YouTube.</span>
          </div>
        )}
        <div className="channel-detail-stats">
          <div><strong>{channel.subscribers}</strong><span>Subscribers</span></div>
          <div><strong>{channel.publishedCount}</strong><span>Published</span></div>
          <div><strong>{channel.scheduledCount}</strong><span>Scheduled</span></div>
        </div>
        <section className="channel-detail-section">
          <div className="channel-detail-section-title"><CalendarClock size={15} /><h3>Publishing preferences</h3></div>
          <div className="channel-detail-pair"><span>Publishing days</span><strong>{channel.scheduleDays}</strong></div>
          <div className="channel-detail-pair"><span>Preferred time</span><strong>{channel.scheduleTime}</strong></div>
          <div className="channel-detail-pair"><span>Assigned pipeline</span><strong>{channel.pipeline}</strong></div>
        </section>
        <section className="channel-detail-section channel-recent-uploads">
          <div className="channel-detail-section-title"><Video size={15} /><h3>Associated content</h3></div>
          {channel.recentUploads.length > 0 ? channel.recentUploads.map((upload) => (
            <div className="channel-upload-row" key={upload.title}>
              <span className="channel-upload-icon"><Video size={14} /></span>
              <span className="channel-upload-title"><Link to={`/content?content=${encodeURIComponent(upload.id)}`}>{upload.title}</Link><small>{upload.date}</small></span>
              <Badge tone={upload.tone} dot>{upload.status}</Badge>
            </div>
          )) : (
            <EmptyState icon={<Video size={18} />} title="No content yet" description="Create an idea and assign it to this channel to begin." action={<Link to="/content">Open Content</Link>} />
          )}
        </section>
        <div className="dialog-footer">
          {!channel.connected && <Button variant="primary" icon={<Plus size={15} />} onClick={onConnect}>Mock-connect channel</Button>}
          <Button variant={channel.connected ? 'primary' : 'secondary'} onClick={onClose}>Done</Button>
        </div>
        <p className="dialog-note">Channel information is illustrative mock data. No YouTube connection is active.</p>
      </section>
    </div>
  )
}

function ChannelsPage() {
  const { state, actions } = useStore()
  const channelRows = useChannelRows()
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined)
  const onCreate = () => setEditingId(null)

  const [filter, setFilter] = useState('all')
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const selectedChannel = channelRows.find(channel => channel.id === selectedChannelId) ?? null
  const connectedChannels = channelRows.filter((channel) => channel.connected)
  const visibleChannels = channelRows.filter((channel) => (
    filter === 'all' || (filter === 'connected' ? channel.connected : !channel.connected)
  ))
  const scheduledTotal = channelRows.reduce((total, channel) => total + channel.scheduledCount, 0)
  const publishedTotal = channelRows.reduce((total, channel) => total + channel.publishedCount, 0)

  return (
    <>
      <PageHeading
        eyebrow="CHANNEL MANAGEMENT · MOCK DATA"
        title="Channels"
        description="Manage channel schedules, content, and connection status in one place."
        action={<Button variant="primary" icon={<Plus size={16} />} onClick={onCreate}>Create channel</Button>}
      />
      <div className="stat-grid stat-grid-compact channel-summary-stats">
        <StatCard label="Connected channels" value={String(connectedChannels.length)} change={`${channelRows.length - connectedChannels.length} disconnected`} changeTone="neutral" icon={<Radio size={18} />} />
        <StatCard label="Videos scheduled" value={String(scheduledTotal)} change="Across all channels" changeTone="neutral" icon={<CalendarDays size={18} />} tone="blue" />
        <StatCard label="Videos published" value={String(publishedTotal)} change="Across all channels" changeTone="neutral" icon={<Video size={18} />} tone="green" />
      </div>
      <div className="page-section">
        <SectionHeading
          title="All channels"
          action={<Select aria-label="Channel filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All channels</option><option value="connected">Connected</option><option value="disconnected">Disconnected</option></Select>}
        />
        {visibleChannels.length > 0 ? (
          <div className="channel-card-grid">
            {visibleChannels.map((channel) => (
              <Card className={`channel-card${channel.connected ? '' : ' channel-card-disconnected'}`} key={channel.name}>
                <div className="channel-card-top">
                  <Avatar initials={channel.initials} className={`channel-avatar-large ${channel.color}`} />
                  <Badge tone={channel.connected ? 'green' : 'neutral'} dot>{channel.connected ? 'Connected' : 'Disconnected'}</Badge>
                  <button className="icon-button" onClick={() => setEditingId(channel.id)} aria-label={`Edit ${channel.name}`}><MoreHorizontal size={17} /></button>
                </div>
                <h3>{channel.name}</h3>
                <p className="channel-handle">{channel.handle}</p>
                <p className="channel-category">{channel.category}</p>
                <div className="channel-schedule">
                  <span><CalendarDays size={13} />Upload schedule</span>
                  <strong>{channel.scheduleDays}</strong>
                  <small>{channel.scheduleTime}</small>
                </div>
                <div className="channel-stats channel-content-stats">
                  <div><strong>{channel.scheduledCount}</strong><span>Scheduled</span></div>
                  <div><strong>{channel.publishedCount}</strong><span>Published</span></div>
                </div>
                <div className="channel-last-activity">
                  <span>Last activity</span>
                  <strong>{channel.recentActivity}</strong>
                  <small>{channel.activityTime}</small>
                </div>
                {Array.from(state.content.values()).some(item => item.channelId === channel.id) && <p className="disabled-action-note">Reassign or delete this channel’s content to enable deletion.</p>}
                <div className="channel-card-actions">
                  <Button variant="secondary" onClick={() => setSelectedChannelId(channel.id)}>Channel details</Button>
                  <Button variant="quiet" onClick={() => actions.updateChannel(channel.id, { status: channel.connected ? 'disconnected' : 'connected' })}>{channel.connected ? 'Disconnect' : 'Mock connect'}</Button>
                  <Button variant="quiet" disabled={Array.from(state.content.values()).some(item => item.channelId === channel.id)} title="Reassign or delete this channel’s content before deleting the channel" onClick={() => actions.requestDelete('channel', channel.id)}>Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Radio size={20} />}
            title={!channelRows.length ? 'No channels yet' : filter === 'connected' ? 'No connected channels' : 'No disconnected channels'}
            description={!channelRows.length ? 'Create a mock channel to start organizing content.' : filter === 'connected' ? 'Mock-connect a channel to see it here.' : 'All listed channels are currently connected in this mock workspace.'}
            action={!channelRows.length || filter === 'connected' ? <Button variant="primary" icon={<Plus size={15} />} onClick={onCreate}>Create channel</Button> : undefined}
          />
        )}
      </div>
      <Card className="channel-preview-note"><span className="notice-icon"><Lightbulb size={17} /></span><span><strong>Mock workspace</strong> Channel statuses, publishing preferences, and video totals are sample data. Connections and settings update this browser workspace only.</span></Card>
      {editingId !== undefined && <ChannelEditor channelId={editingId ?? undefined} onClose={() => setEditingId(undefined)} />}
      {selectedChannel && <ChannelDetailsDialog
        channel={selectedChannel}
        onClose={() => setSelectedChannelId(null)}
        onConnect={() => {
          actions.updateChannel(selectedChannel.id, { status: 'connected' })
        }}
      />}
    </>
  )
}

const providerCategoryIcons: Record<ProviderCategory, LucideIcon> = {
  'Text generation': Sparkles,
  'Text-to-speech': Mic2,
  'Image generation': Image,
  'Video generation': Video,
  'Embeddings / analysis': BrainCircuit,
}

const providerCategorySlugs: Record<ProviderCategory, string> = {
  'Text generation': 'text',
  'Text-to-speech': 'speech',
  'Image generation': 'image',
  'Video generation': 'video',
  'Embeddings / analysis': 'analysis',
}

type ProviderDraft = {
  name: string
  category: ProviderCategory
  model: string
  enabled: boolean
}

function ProviderDialog({
  provider,
  onClose,
  onSave,
}: {
  provider: AIProvider | null
  onClose: () => void
  onSave: (draft: ProviderDraft) => OperationResult | Promise<OperationResult>
}) {
  const submission = useSubmission()
  const ref = useDialog(onClose, submission.pending)
  const { state } = useStore()
  const [name, setName] = useState(provider?.name ?? '')
  const modelsByCategory = useModelsByCategory()
  const [category, setCategory] = useState<ProviderCategory>(provider?.category ?? 'Text generation')
  const [model, setModel] = useState(provider?.models[0] ?? modelsByCategory['Text generation'][0])
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [testResult, setTestResult] = useState(false)
  const availableModels = modelsByCategory[category]

  const handleCategoryChange = (nextCategory: ProviderCategory) => {
    setCategory(nextCategory)
    setModel(modelsByCategory[nextCategory][0])
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submission.submit(() => onSave({ name: name.trim(), category, model, enabled }))
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submission.pending) onClose() }}>
      <section ref={ref} tabIndex={-1} className="dialog provider-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title">
        <div className="dialog-header">
          <div className="dialog-icon"><Sparkles size={19} /></div>
          <Button variant="ghost" iconOnly icon={<X size={18} />} aria-label="Close provider form" onClick={onClose} disabled={submission.pending} />
        </div>
        <h2 id="provider-dialog-title">{provider ? 'Configure provider' : 'Add Provider'}</h2>
        <p className="dialog-description">Set up a provider profile for future pipeline use. This form only updates local preview state.</p>
        <form noValidate aria-busy={submission.pending} onChange={() => { submission.clear(); setTestResult(false) }} onSubmit={handleSubmit}><OperationFeedback result={submission.result} pending={submission.pending} /><fieldset className="editor-fields" disabled={submission.pending}>
          <label className="field-label" htmlFor="provider-name">Provider name</label>
          <input id="provider-name" {...submission.fieldProps('name')} maxLength={80} className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Acme AI" required />

          <FieldError submission={submission} field="name" /><label className="field-label" htmlFor="provider-category">Provider type</label>
          <select id="provider-category" {...submission.fieldProps('category')} className="select select-full" value={category} onChange={(event) => {
            if (isProviderCategory(event.target.value)) handleCategoryChange(event.target.value)
          }}>
            {providerCategories.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>

          <FieldError submission={submission} field="category" /><label className="field-label" htmlFor="provider-api-key">API key <span className="field-label-muted">· UI preview only</span></label>
          <div className="provider-key-field"><KeyRound size={15} /><input id="provider-api-key" type="password" className="text-input" disabled autoComplete="off" placeholder="Do not enter a real API key" /></div>
          <p className="provider-key-note">This field is never read, saved, or sent. Leave it blank.</p>

          <label className="field-label" htmlFor="provider-model">Model selection</label>
          <select id="provider-model" {...submission.fieldProps('models')} className="select select-full" required value={model} onChange={(event) => setModel(event.target.value)}>
            {!availableModels.includes(model) && <option value={model}>{model} · current mock model</option>}
            {availableModels.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>

          <FieldError submission={submission} field="models" /><label className="provider-enabled-setting">
            <span><strong>Enable provider</strong><small>Allow pipelines to select it in this mock workspace.</small></span>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          </label>

          {testResult && <div className="provider-dialog-test-result" role="status"><CheckCircle2 size={15} />Mock test passed — no API request was made.</div>}
          <div className="provider-dialog-footer">
            <Button type="button" variant="secondary" disabled={submission.pending} onClick={() => { void submission.submit(() => {
              const value = { id: provider?.id ?? 'preview-provider', name, category, enabled, connected: false, models: [model], lastUsed: 'Never', createdAt: '', updatedAt: '' }
              const errors = validateProvider(value, state)
              if (Object.keys(errors).length) return validationError(errors)
              setTestResult(true); return { ok: true, message: 'Mock configuration is valid. No external request was made.' }
            }) }}>Test configuration</Button>
            <Button type="submit" variant="primary" disabled={submission.pending}>{submission.pending ? 'Saving…' : provider ? 'Save changes' : 'Save provider'}</Button>
          </div>
        </fieldset></form>
        <p className="dialog-note">Mock state only. No provider authentication or external connection is implemented.</p>
      </section>
    </div>
  )
}

function ProvidersPage() {
  const { actions } = useStore()
  const providers = useProviderRows()
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dialogProvider, setDialogProvider] = useState<AIProvider | null | undefined>(undefined)
  const [testMessage, setTestMessage] = useState('')
  const connectedCount = providers.filter((provider) => provider.connected).length
  const enabledCount = providers.filter((provider) => provider.enabled).length
  const visibleProviders = providers.filter((provider) => categoryFilter === 'all' || provider.category === categoryFilter)
  const providerCategories = useProviderCategories()

  const openAddDialog = () => setDialogProvider(null)
  const closeDialog = () => setDialogProvider(undefined)

  const saveProvider = async (draft: ProviderDraft): Promise<OperationResult> => {
    const result = await (dialogProvider ? actions.updateProvider(dialogProvider.id, { name: draft.name, category: draft.category, models: [draft.model], enabled: draft.enabled }) : actions.addProvider({ id: `mock-provider-${crypto.randomUUID()}`, name: draft.name, category: draft.category, connected: false, enabled: draft.enabled, models: [draft.model], lastUsed: 'Never', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
    if (result.ok) { setTestMessage(''); closeDialog() }
    return result
  }

  const testProvider = async (providerId: string) => {
    const provider = providers.find(item => item.id === providerId)
    const providerName = provider?.name ?? 'provider'
    if (!provider) return
    const result = await actions.updateProvider(provider.id, { connected: true })
    if (!result.ok) return
    setTestMessage(`Mock connection test for ${providerName} passed. No API was called.`)
  }

  const toggleProvider = (providerId: string) => {
    actions.toggleProvider(providerId)
  }

  return (
    <>
      <PageHeading
        eyebrow="PROVIDER MANAGEMENT · MOCK DATA"
        title="AI Providers"
        description="Configure the model services your content pipelines can use."
        action={<Button variant="primary" icon={<Plus size={16} />} onClick={openAddDialog}>Add Provider</Button>}
      />
      <Card className="provider-preview-banner">
        <span className="notice-icon"><KeyRound size={17} /></span>
        <div><strong>UI preview only</strong><p>API key fields are never saved. Save and test actions use local mock states and never contact an external provider.</p></div>
        <Badge tone="violet">Mock data</Badge>
      </Card>
      <div className="stat-grid stat-grid-compact provider-summary-grid">
        <StatCard label="Configured providers" value={String(providers.length)} change="Across 5 categories" changeTone="neutral" icon={<Sparkles size={18} />} />
        <StatCard label="Mock connected" value={String(connectedCount)} change="Sample connection states" changeTone="neutral" icon={<Radio size={18} />} tone="green" />
        <StatCard label="Enabled for pipelines" value={String(enabledCount)} change="Local preview setting" changeTone="neutral" icon={<Workflow size={18} />} tone="blue" />
      </div>
      <div className="providers-toolbar">
        <div><h2>Provider list</h2><p>Provider settings can be replaced with service-backed data later.</p></div>
        <Select aria-label="Filter provider category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="all">All categories</option>
          {providerCategories.map((category) => <option key={category} value={category}>{category}</option>)}
        </Select>
      </div>
      {testMessage && <div className="provider-test-message" role="status"><CheckCircle2 size={15} />{testMessage}<Button variant="ghost" iconOnly icon={<X size={15} />} aria-label="Dismiss test result" onClick={() => setTestMessage('')} /></div>}
      {visibleProviders.length > 0 ? (
        <Card className="provider-table-card">
          <div className="provider-table-wrap">
            <table className="provider-table">
              <thead><tr><th>PROVIDER</th><th>TYPE</th><th>CONNECTION</th><th>MODELS AVAILABLE</th><th>LAST USED</th><th>ENABLED</th><th>ACTIONS</th></tr></thead>
              <tbody>
                {visibleProviders.map((provider) => {
                  const TypeIcon = providerCategoryIcons[provider.category]
                  return (
                    <tr key={provider.id}>
                      <td><div className="provider-table-name"><span className={`provider-row-icon provider-type-${providerCategorySlugs[provider.category]}`}><TypeIcon size={16} /></span><strong>{provider.name}</strong></div></td>
                      <td><span className="provider-category-label">{provider.category}</span></td>
                      <td><Badge tone={provider.connected ? 'green' : 'neutral'} dot>{provider.connected ? 'Mock connected' : 'Not configured'}</Badge></td>
                      <td><div className="provider-model-list">{provider.models.map((model) => <span key={model}>{model}</span>)}</div></td>
                      <td className="provider-last-used">{provider.lastUsed}</td>
                      <td><button className={`provider-switch${provider.enabled ? ' provider-switch-on' : ''}`} role="switch" aria-checked={provider.enabled} aria-label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.name}`} onClick={() => toggleProvider(provider.id)}><span /></button><span className="provider-enabled-label">{provider.enabled ? 'On' : 'Off'}</span></td>
                      <td><div className="provider-actions"><Button variant="quiet" onClick={() => testProvider(provider.id)}>Test</Button><Button variant="secondary" onClick={() => setDialogProvider(provider)}>Configure</Button><Button variant="quiet" onClick={() => actions.requestDelete('provider', provider.id)}>Delete</Button></div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState icon={<Sparkles size={20} />} title={providers.length ? "No providers in this category" : "No providers yet"} description="Add a provider to configure mock models for this type." action={<Button variant="primary" icon={<Plus size={15} />} onClick={openAddDialog}>Add Provider</Button>} />
      )}
      <div className="provider-category-grid">
        {providerCategories.map((category) => {
          const Icon = providerCategoryIcons[category]
          const count = providers.filter((provider) => provider.category === category).length
          return <button className="provider-category-card" key={category} onClick={() => setCategoryFilter(category)}><span className={`provider-row-icon provider-type-${providerCategorySlugs[category]}`}><Icon size={16} /></span><span><strong>{category}</strong><small>{count} {count === 1 ? 'provider' : 'providers'}</small></span><ArrowRight size={15} /></button>
        })}
      </div>
      <Card className="provider-safety"><span className="safety-check"><Check size={15} /></span><span><strong>Nothing leaves this preview.</strong> API key input is never read, persisted, or transmitted; test results are simulated.</span></Card>
      {dialogProvider !== undefined && <ProviderDialog
        provider={dialogProvider}
        onClose={closeDialog}
        onSave={saveProvider}
      />}
    </>
  )
}

function PipelineBuilderDialog({
  pipeline,
  onClose,
  onSave,
}: {
  pipeline: Pipeline | null
  onClose: () => void
  onSave: (pipeline: Pipeline) => OperationResult | Promise<OperationResult>
}) {
  const submission = useSubmission()
  const ref = useDialog(onClose, submission.pending)
  const channelRows = useChannelRows()
  const initialProviders = useProviderRows()
  const { state } = useStore()
  const withPreferredProvider = (step: PipelineStep): PipelineStep => {
    const preferred = step.kind === 'Voice' ? state.preferences?.voiceProviderId : ['Visuals', 'Thumbnail'].includes(step.kind) ? state.preferences?.imageProviderId : ['Idea', 'Script', 'Research'].includes(step.kind) ? state.preferences?.textProviderId : null
    return { ...step, config: { ...step.config, providerId: preferred && state.providers.get(preferred)?.enabled ? preferred : null } }
  }
  const [name, setName] = useState(pipeline?.name ?? '')
  const [description, setDescription] = useState(pipeline?.description ?? '')
  const [assignedChannels, setAssignedChannels] = useState(pipeline?.assignedChannels ?? [])
  const [enabled, setEnabled] = useState(pipeline?.enabled ?? true)
  const [steps, setSteps] = useState(() => pipeline ? pipeline.steps.map((step) => ({ ...step, config: { ...step.config } })) : createDefaultSteps().map(withPreferredProvider))
  const [stepToAdd, setStepToAdd] = useState<PipelineStepKind>('Research')

  const updateStep = (stepId: string, update: (step: PipelineStep) => PipelineStep) => {
    setSteps((current) => current.map((step) => step.id === stepId ? update(step) : step))
  }

  const moveStep = (index: number, direction: -1 | 1) => {
    const destination = index + direction
    if (destination < 0 || destination >= steps.length) return
    setSteps((current) => {
      const reordered = [...current]
      const [moving] = reordered.splice(index, 1)
      reordered.splice(destination, 0, moving)
      return reordered
    })
  }

  const addStep = () => {
    setSteps((current) => [...current, withPreferredProvider(createPipelineStep(stepToAdd, current.length))])
  }

  const removeStep = (stepId: string) => {
    setSteps((current) => current.filter((step) => step.id !== stepId))
  }

  const toggleChannel = (channel: string) => {
    setAssignedChannels((current) => current.includes(channel)
      ? current.filter((assigned) => assigned !== channel)
      : [...current, channel])
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submission.submit(() => onSave({
      id: pipeline?.id ?? `pipeline-${crypto.randomUUID()}`,
      name: name.trim(),
      description: description.trim(),
      assignedChannels,
      enabled,
      lastUsed: pipeline?.lastUsed ?? 'Never',
      steps,
    }))
  }

  const orderedSteps = steps.filter((step) => step.enabled)

  return (
    <div className="modal-backdrop pipeline-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submission.pending) onClose() }}>
      <section ref={ref} tabIndex={-1} className="dialog pipeline-builder-dialog" role="dialog" aria-modal="true" aria-labelledby="pipeline-builder-title">
        <div className="dialog-header">
          <div className="dialog-icon"><Workflow size={19} /></div>
          <Button variant="ghost" iconOnly icon={<X size={18} />} aria-label="Close pipeline builder" onClick={onClose} disabled={submission.pending} />
        </div>
        <h2 id="pipeline-builder-title">{pipeline ? 'Edit pipeline' : 'Create pipeline'}</h2>
        <p className="dialog-description">Define each handoff from the original idea through review and publishing. This builder only edits mock configuration.</p>
        <form noValidate aria-busy={submission.pending} onChange={submission.clear} onSubmit={handleSubmit}><OperationFeedback result={submission.result} pending={submission.pending} /><fieldset className="editor-fields" disabled={submission.pending}>
          <div className="pipeline-builder-top-fields">
            <label><span className="field-label">Pipeline name</span><input className="text-input" {...submission.fieldProps('name')} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Weekly creator video" required maxLength={80} /><FieldError submission={submission} field="name" /></label>
            <label><span className="field-label">Description</span><input className="text-input" {...submission.fieldProps('description')} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What will this pipeline create?" maxLength={180} /><FieldError submission={submission} field="description" /></label>
          </div>
          <div className="pipeline-builder-settings">
            <fieldset className="pipeline-channel-assignment">
              <legend>Assigned channels</legend>
              <FieldError submission={submission} field="assignedChannelIds" />{channelRows.map((channel) => <label key={channel.name}><input type="checkbox" checked={assignedChannels.includes(channel.id)} onChange={() => toggleChannel(channel.id)} />{channel.name}</label>)}
            </fieldset>
            <label className="pipeline-enabled-setting"><span><strong>Pipeline enabled</strong><small>Available to select for new content in this preview.</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></label>
          </div>

          <section className="pipeline-flow-preview" aria-label="Pipeline flow preview">
            <div><strong>At a glance</strong><span>{orderedSteps.length} active of {steps.length} steps</span></div>
            {orderedSteps.length > 0 ? <div className="pipeline-flow-track">{orderedSteps.map((step, index) => <span className="pipeline-flow-node" key={step.id}>{step.kind}{index < orderedSteps.length - 1 && <ArrowRight size={13} aria-hidden="true" />}</span>)}</div> : <p>Enable at least one step to see the execution path.</p>}
          </section>

          <div className="pipeline-builder-list-heading"><div><h3>Pipeline steps</h3><p>Move steps to define order. Disabled steps are skipped.</p></div><span>{steps.length} total</span></div>
          <FieldError submission={submission} field="steps" /><div className="pipeline-builder-steps">
            {steps.length === 0 ? <EmptyState icon={<Workflow size={19} />} title="No steps added" description="Add a step to define how content should move forward." /> : steps.map((step, index) => (
              <article aria-invalid={Boolean(submission.error(`steps.${index}`))} className={`pipeline-builder-step${step.enabled ? '' : ' pipeline-builder-step-disabled'}`} key={step.id}>
                <FieldError submission={submission} field={`steps.${index}`} /><div className="pipeline-builder-step-main">
                  <span className={`pipeline-builder-step-number${step.enabled ? '' : ' step-number-disabled'}`}>{index + 1}</span>
                  <div className="pipeline-builder-step-name"><strong>{step.kind}</strong><small>{step.enabled ? 'This step is included in the flow' : 'This step is currently skipped'}</small></div>
                  <div className="pipeline-step-order-actions">
                    <Button type="button" variant="quiet" iconOnly icon={<ChevronUp size={15} />} aria-label={`Move ${step.kind} up`} disabled={index === 0} title={index === 0 ? 'This step is already first' : 'Move step up'} onClick={() => { submission.clear(); moveStep(index, -1) }} />
                    <Button type="button" variant="quiet" iconOnly icon={<ChevronDown size={15} />} aria-label={`Move ${step.kind} down`} disabled={index === steps.length - 1} title={index === steps.length - 1 ? 'This step is already last' : 'Move step down'} onClick={() => { submission.clear(); moveStep(index, 1) }} />
                  </div>
                  <label className="pipeline-step-enable"><input type="checkbox" aria-label={`${step.enabled ? 'Disable' : 'Enable'} ${step.kind} step`} checked={step.enabled} onChange={(event) => updateStep(step.id, (current) => ({ ...current, enabled: event.target.checked }))} /><span>{step.enabled ? 'On' : 'Off'}</span></label>
                  <Button type="button" variant="quiet" iconOnly icon={<Trash2 size={15} />} aria-label={`Remove ${step.kind} step`} onClick={() => { submission.clear(); removeStep(step.id) }} />
                </div>
                <div className="pipeline-step-config">
                  <label><span>Instructions</span><input className="text-input" maxLength={2000} {...submission.fieldProps(`steps.${index}.instructions`)} value={step.config.instructions} onChange={(event) => updateStep(step.id, (current) => ({ ...current, config: { ...current.config, instructions: event.target.value } }))} placeholder={`Notes for the ${step.kind.toLowerCase()} step`} /><FieldError submission={submission} field={`steps.${index}.instructions`} /></label>
                  <label><span>Assigned provider · mock</span><Select {...submission.fieldProps(`steps.${index}.providerId`)} value={step.config.providerId ?? ''} onChange={(event) => updateStep(step.id, (current) => ({ ...current, config: { ...current.config, providerId: event.target.value || null } }))}><option value="">No provider assigned</option>{initialProviders.filter(provider => providerTypesForStep(step.kind).includes(provider.category)).map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.enabled}>{provider.name}{!provider.enabled ? ' (disabled)' : ''} · {provider.category}</option>)}</Select><FieldError submission={submission} field={`steps.${index}.providerId`} /></label>
                </div>
              </article>
            ))}
          </div>
          <div className="pipeline-add-step-row"><Select aria-label="Step to add" value={stepToAdd} onChange={(event) => {
            if (pipelineStepKinds.includes(event.target.value as PipelineStepKind)) setStepToAdd(event.target.value as PipelineStepKind)
          }}>{pipelineStepKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</Select><Button type="button" variant="secondary" icon={<Plus size={15} />} disabled={steps.length >= 50} title={steps.length >= 50 ? 'A pipeline can contain up to 50 steps' : 'Add another step'} onClick={() => { submission.clear(); addStep() }}>Add step</Button></div>
          <div className="pipeline-builder-footer"><span>All settings are local preview data. Saving does not run steps or connect services.</span><div><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" icon={<Check size={15} />} disabled={submission.pending}>{submission.pending ? 'Saving…' : 'Save pipeline'}</Button></div></div>
        </fieldset></form>
      </section>
    </div>
  )
}

function WorkflowsPage() {
  const { state, actions } = useStore()
  const pipelines = usePipelineRows()
  const channelRows = useChannelRows()
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null | undefined>(undefined)
  const [detailsPipelineId, setDetailsPipelineId] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState('')
  const enabledCount = pipelines.filter((pipeline) => pipeline.enabled).length
  const totalSteps = pipelines.reduce((total, pipeline) => total + pipeline.steps.filter((step) => step.enabled).length, 0)

  const savePipeline = async (pipeline: Pipeline) => {
    const value = { ...pipeline, assignedChannelIds: pipeline.assignedChannels, steps: pipeline.steps.map((step, order) => ({ ...step, order })), createdAt: state.pipelines.get(pipeline.id)?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() }
    const result = await (editingPipeline ? actions.updatePipeline(editingPipeline.id, value) : actions.addPipeline(value))
    if (!result.ok) return result
    setSavedMessage(`“${pipeline.name}” saved to your mock pipeline library.`)
    setEditingPipeline(undefined)
    return result
  }

  const togglePipeline = (pipelineId: string) => {
    actions.togglePipeline(pipelineId)
  }

  const createPipeline = () => setEditingPipeline(null)

  return (
    <>
      <PageHeading eyebrow="A LITTLE STRUCTURE, A LOT OF FLOW" title="Pipelines" description="Make every handoff clear, from the first idea to a finished piece of content." action={<AddButton onClick={createPipeline}>New pipeline</AddButton>} />
      <div className="stat-grid stat-grid-compact">
        <StatCard label="Enabled pipelines" value={String(enabledCount)} change={`${pipelines.length - enabledCount} paused`} icon={<Workflow size={18} />} />
        <StatCard label="Configured steps" value={String(totalSteps)} change="Across enabled and draft flows" icon={<Activity size={18} />} tone="blue" />
        <StatCard label="Available channels" value={String(channelRows.filter((channel) => channel.connected).length)} change="Mock channel profiles" icon={<Radio size={18} />} tone="green" />
      </div>
      {savedMessage && <div className="content-created-message pipeline-saved-message" role="status"><CheckCircle2 size={15} />{savedMessage}<button type="button" aria-label="Dismiss notification" onClick={() => setSavedMessage('')}><X size={15} /></button></div>}
      <div className="section-heading pipeline-section-heading"><div><h2>Your pipelines</h2><p>Every enabled step runs in the order shown. Disabled steps are skipped.</p></div><Badge tone="neutral">{pipelines.length} total</Badge></div>
      {pipelines.length === 0 ? <EmptyState icon={<Workflow size={21} />} title="No pipelines yet" description="Create a pipeline to define a reusable path from idea to publish-ready content." action={<Button variant="primary" icon={<Plus size={15} />} onClick={createPipeline}>Create pipeline</Button>} /> : (
        <div className="pipeline-list">
          {pipelines.map((pipeline) => (
            <Card className="pipeline-card pipeline-library-card" key={pipeline.id}>
              <div className="pipeline-card-header">
                <span className="pipeline-icon"><Workflow size={18} /></span>
                <div className="pipeline-title"><h3>{pipeline.name}</h3><p>{pipeline.description || 'No description provided.'}</p></div>
                <Badge tone={pipeline.enabled && Object.keys(validatePipeline(state.pipelines.get(pipeline.id)!, state)).length ? 'amber' : pipeline.enabled ? 'green' : 'neutral'} dot>{pipeline.enabled && Object.keys(validatePipeline(state.pipelines.get(pipeline.id)!, state)).length ? 'Needs attention' : pipeline.enabled ? 'Enabled' : 'Disabled'}</Badge>
              </div>
              <div className="pipeline-card-metadata">
                <div><span>ASSIGNED CHANNELS</span><p>{pipeline.assignedChannels.length > 0 ? pipeline.assignedChannels.map((channel) => <Badge key={channel} tone="neutral">{state.channels.get(channel)?.name ?? "Unassigned"}</Badge>) : <em>None assigned</em>}</p></div>
                <div><span>STEPS</span><strong>{pipeline.steps.length} total · {pipeline.steps.filter((step) => step.enabled).length} active</strong></div>
                <div><span>LAST USED</span><strong>{pipeline.lastUsed}</strong></div>
              </div>
              <div className="pipeline-library-flow" aria-label={`Enabled steps in ${pipeline.name}`}>
                {pipeline.steps.filter((step) => step.enabled).map((step, index, activeSteps) => <span key={step.id}>{step.kind}{index < activeSteps.length - 1 && <ArrowRight size={12} aria-hidden="true" />}</span>)}
                {pipeline.steps.every((step) => !step.enabled) && <span className="pipeline-flow-empty">No active steps</span>}
              </div>
              {[...state.jobs.values()].filter(job => job.execution?.pipelineId === pipeline.id).slice(-3).map(job => <p key={job.id} className="dialog-note"><Link to={`/content?content=${encodeURIComponent(job.contentId)}`}>{state.content.get(job.contentId)?.title ?? 'Content'}</Link> · {job.execution!.paused ? 'Paused' : job.execution!.status} · {job.execution!.progress}%</p>)}
              <Button variant="quiet" onClick={() => setDetailsPipelineId(pipeline.id)}>Pipeline details & executions</Button>
              <div className="pipeline-card-footer pipeline-library-footer"><span>Reusable workflow definition <strong>· mock only</strong></span><div><Button variant="quiet" onClick={() => togglePipeline(pipeline.id)}>{pipeline.enabled ? 'Disable' : 'Enable'}</Button><Button variant="secondary" icon={<Settings2 size={14} />} onClick={() => setEditingPipeline(pipeline)}>Edit pipeline</Button><Button variant="quiet" onClick={() => actions.requestDelete('pipeline', pipeline.id)}>Delete</Button></div></div>
            </Card>
          ))}
        </div>
      )}
      <Card className="pipeline-preview-note"><span className="notice-icon"><Lightbulb size={17} /></span><div><strong>Mock execution available</strong><p>Open a content item’s Details to run its configured steps, pause, resume, cancel, or retry. No AI, media processing, or real publishing service is connected.</p></div></Card>
      {editingPipeline !== undefined && <PipelineBuilderDialog pipeline={editingPipeline} onClose={() => setEditingPipeline(undefined)} onSave={savePipeline} />}
      {detailsPipelineId && <PipelineDetailsDialog pipelineId={detailsPipelineId} onClose={() => setDetailsPipelineId(null)} />}
    </>
  )
}

function formatContentDate(value: string, timezone = 'UTC'): string {
  if (!value) return '—'
  if (value.length === 16 || value.length === 10) return formatWallTime(value, { month: 'short', day: 'numeric', year: 'numeric', ...(value.length > 10 ? { hour: 'numeric', minute: '2-digit' } : {}) })
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(value.length > 10 ? { hour: 'numeric', minute: '2-digit' } : {}), timeZone: timezone,
  }).format(date)
}

function ContentDetailsDialog({ item, onClose, onEdit, onSchedule }: { item: ContentItem; onClose: () => void; onEdit: () => void; onSchedule: () => void }) {
  const { state } = useStore()
  const timezone = state.preferences?.timezone ?? 'UTC'
  const ref = useDialog(onClose, false)
  const activeStep = item.status === 'Failed' ? -1 : contentStatuses.indexOf(item.status)

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={ref} tabIndex={-1} className="dialog content-dialog content-details-dialog" role="dialog" aria-modal="true" aria-labelledby="content-details-title">
        <div className="dialog-header"><div className="dialog-icon"><Video size={19} /></div><Button variant="ghost" iconOnly icon={<X size={18} />} aria-label="Close content details" onClick={onClose} /></div>
        <div className="content-details-title"><div><h2 id="content-details-title">{item.title}</h2><p>{item.channel} · {item.format}</p></div><Badge tone={contentStatusTone[item.status]} dot>{item.status}</Badge></div>
        <VideoThumbnail kind={item.image} />
        <div className="content-lifecycle">
          <p className="card-kicker">CONTENT LIFECYCLE</p>
          <div className="content-lifecycle-steps">{contentStatuses.map((status, index) => <div className={`content-lifecycle-step${index <= activeStep ? ' lifecycle-complete' : ''}${status === item.status ? ' lifecycle-current' : ''}`} key={status}><span>{index + 1}</span><small>{status}</small></div>)}</div>
          {item.status === 'Failed' && <p className="content-failed-note"><AlertTriangle size={14} />This item is marked failed in mock data and needs review.</p>}
        </div>
        <dl className="content-details-grid">
          <div><dt>Pipeline</dt><dd>{item.pipeline}</dd></div>
          <div><dt>Created</dt><dd>{formatContentDate(item.createdAt, timezone)}</dd></div>
          <div><dt>Scheduled date</dt><dd>{formatContentDate(item.scheduledAt, timezone)}</dd></div>
          <div><dt>Publishing preference</dt><dd>{item.publishPreference}</dd></div>
          <div className="content-detail-notes"><dt>Notes</dt><dd>{item.notes || 'No notes added.'}</dd></div>
        </dl>
        <PipelineExecutionPanel contentId={item.id} />
        <div className="dialog-footer"><Button onClick={onEdit}>Edit content</Button>{canScheduleContent(state, item.id) && <Button variant="primary" onClick={onSchedule}>Schedule ready content</Button>}{item.status === 'Scheduled' && <Link to="/scheduler">View scheduled job</Link>}{item.status === 'Published' && <p role="status">Mock publication complete. Jobs and activity are available below.</p>}</div>
        <JobQueuePanel contentId={item.id} />
      </section>
    </div>
  )
}

function ContentPage() {
  const { state, actions } = useStore()
  const items = useContentRows()
  const channelRows = useChannelRows()
  const initialPipelines = usePipelineRows()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedItem = items.find(item => item.id === searchParams.get('content')) ?? null
  const setSelectedItem = (item: ContentItem | null) => setSearchParams(previous => { const next = new URLSearchParams(previous); if (item) next.set('content', item.id); else next.delete('content'); return next })
  const [scheduleContentId, setScheduleContentId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined)
  const search = searchParams.get('search') ?? ''
  const setSearch = (value: string) => setSearchParams(previous => { const next = new URLSearchParams(previous); if (value) next.set('search', value); else next.delete('search'); return next }, { replace: true })
  const searchRef = useRef<HTMLInputElement>(null)
  const focusSearch = searchParams.get('focus') === 'search'
  useEffect(() => { if (focusSearch) searchRef.current?.focus() }, [focusSearch])
  const [channelFilter, setChannelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [pipelineFilter, setPipelineFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [contentReferenceTime] = useState(() => Date.now())

  const normalizedSearch = search.trim().toLowerCase()
  const visibleItems = items.filter((item) => {
    const matchesSearch = !normalizedSearch || [item.title, item.channel, item.pipeline, item.status, item.format, item.notes].some((field) => field.toLowerCase().includes(normalizedSearch))
    const matchesChannel = channelFilter === 'all' || item.channel === channelFilter
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter
    const matchesPipeline = pipelineFilter === 'all' || item.pipeline === pipelineFilter
    const age = contentReferenceTime - new Date(item.createdAt).getTime()
    const dateLimits: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
    const matchesDate = dateFilter === 'all' || age <= dateLimits[dateFilter] * 24 * 60 * 60 * 1000
    return matchesSearch && matchesChannel && matchesStatus && matchesPipeline && matchesDate
  }).sort((first, second) => second.createdAt.localeCompare(first.createdAt))

  const inProgressCount = items.filter((item) => ['Script', 'Generating', 'Editing', 'Ready'].includes(item.status)).length
  const scheduledCount = workspaceCounts(state).scheduled
  const publishedCount = items.filter((item) => item.status === 'Published').length

  return (
    <>
      <PageHeading eyebrow="EVERY IDEA HAS A HOME" title="Content" description="Keep the drafts, works-in-progress, and published stories moving." action={<AddButton onClick={() => setEditingId(null)}>Create content</AddButton>} />
      {searchParams.get('content') && !selectedItem && <EmptyState icon={<Video size={18} />} title="Content unavailable" description="This content was removed or the link is no longer available." action={<Button onClick={() => setSelectedItem(null)}>Close unavailable item</Button>} />}
      <div className="content-summary-strip" aria-label="Content summary"><span><strong>{items.length}</strong> total pieces</span><i /><span><strong>{inProgressCount}</strong> in progress</span><i /><span><strong>{scheduledCount}</strong> scheduled</span><i /><span><strong>{publishedCount}</strong> published</span></div>

      <Card className="content-table-card">
        <div className="content-filter-toolbar">
          <label className="content-search"><Search size={15} /><input ref={searchRef} aria-label="Search content" placeholder="Search titles, channels, pipelines…" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label>
          <div className="content-filter-controls">
            <Select aria-label="Filter by channel" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}><option value="all">All channels</option>{channelRows.map((channel) => <option value={channel.name} key={channel.name}>{channel.name}</option>)}</Select>
            <Select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{contentStatuses.map((status) => <option value={status} key={status}>{status}</option>)}</Select>
            <Select aria-label="Filter by pipeline" value={pipelineFilter} onChange={(event) => setPipelineFilter(event.target.value)}><option value="all">All pipelines</option>{initialPipelines.map((pipeline) => <option value={pipeline.name} key={pipeline.name}>{pipeline.name}</option>)}</Select>
            <Select aria-label="Filter by created date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">Any date</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></Select>
          </div>
        </div>
        {items.length === 0 ? (
          <EmptyState icon={<Video size={21} />} title="Your content library is ready" description="Add a topic or idea to start shaping your next piece of content." action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditingId(null)}>Create content</Button>} />
        ) : visibleItems.length === 0 ? (
          <EmptyState icon={<Search size={21} />} title="No matching content" description="Try changing your search or filters to find what you’re looking for." action={<Button variant="secondary" onClick={() => { setSearch(''); setChannelFilter('all'); setStatusFilter('all'); setPipelineFilter('all'); setDateFilter('all') }}>Clear filters</Button>} />
        ) : (
          <>
            <div className="table-wrap content-table-wrap"><table className="content-library-table"><thead><tr><th>CONTENT</th><th>CHANNEL</th><th>PIPELINE</th><th>STATUS</th><th>CREATED</th><th>SCHEDULED</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id}>
              <td><div className="table-video"><VideoThumbnail kind={item.image} compact /><div><strong>{item.title}</strong><small>{item.format}</small></div></div></td>
              <td><span className="table-channel"><span className={`tiny-channel ${item.channel === 'Creative Growth' ? 'purple-dot' : 'green-dot'}`} />{item.channel}</span></td>
              <td className="content-pipeline-cell">{item.pipeline}</td>
              <td><Badge tone={contentStatusTone[item.status]} dot>{item.status}</Badge></td>
              <td className="table-date">{formatContentDate(item.createdAt, state.preferences?.timezone)}</td>
              <td className="table-date">{formatContentDate(item.scheduledAt, state.preferences?.timezone)}</td>
              <td><Button variant="quiet" className="content-details-action" onClick={() => setSelectedItem(item)}>Details</Button><Button variant="quiet" onClick={() => setEditingId(item.id)}>Edit</Button><Button variant="quiet" onClick={() => actions.requestDelete('content', item.id)}>Delete</Button></td>
            </tr>)}</tbody></table></div>
            <div className="table-footer"><span>Showing {visibleItems.length} of {items.length} pieces</span><span className="content-mock-label">Mock content · browser workspace</span></div>
          </>
        )}
      </Card>
      {editingId !== undefined && <ContentEditor contentId={editingId ?? undefined} onClose={() => setEditingId(undefined)} onSaved={id => setSearchParams({ content: id })} />}
      {selectedItem && <ContentDetailsDialog item={selectedItem} onClose={() => setSelectedItem(null)} onEdit={() => { setEditingId(selectedItem.id); setSelectedItem(null) }} onSchedule={() => { setScheduleContentId(selectedItem.id); setSelectedItem(null) }} />}
      {scheduleContentId && <ScheduleEditor initialContentId={scheduleContentId} onClose={() => { setSearchParams({ content: scheduleContentId }); setScheduleContentId(null) }} />}
    </>
  )
}

const scheduleStatusTone: Record<ScheduleStatus, 'blue' | 'green' | 'amber' | 'red'> = {
  Scheduled: 'blue',
  Ready: 'green',
  Processing: 'amber',
  'Needs attention': 'red',
}

function scheduledDateLabel(value: string, includeWeekday = true): string {
  return formatWallTime(value, {
    ...(includeWeekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function scheduledTimeLabel(value: string): string {
  return formatWallTime(value, { hour: 'numeric', minute: '2-digit' })
}

function getMonday(date: Date): Date {
  const monday = new Date(date)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return monday
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function SchedulerDetailsDialog({
  item,
  onClose,
  onReschedule,
}: {
  item: ScheduledVideo
  onClose: () => void
  onReschedule: (id: string, scheduledAt: string) => OperationResult | Promise<OperationResult>
}) {
  const submission = useSubmission()
  const ref = useDialog(onClose, submission.pending)
  const { state } = useStore()
  const [rescheduling, setRescheduling] = useState(false)
  const [date, setDate] = useState(item.scheduledAt.slice(0, 10))
  const [time, setTime] = useState(item.scheduledAt.slice(11, 16))

  const handleReschedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submission.submit(() => onReschedule(item.id, `${date}T${time}`))
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submission.pending) onClose() }}>
      <section ref={ref} tabIndex={-1} className="dialog schedule-details-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-details-title">
        <div className="dialog-header"><div className="dialog-icon"><CalendarClock size={19} /></div><Button variant="ghost" iconOnly icon={<X size={18} />} aria-label="Close schedule details" onClick={onClose} disabled={submission.pending} /></div>
        <div className="schedule-details-heading"><div><h2 id="schedule-details-title">{item.title}</h2><p>{item.channel} · {item.pipeline}</p></div><Badge tone={scheduleStatusTone[item.status]} dot>{item.status}</Badge></div>
        <VideoThumbnail kind={item.thumbnail} />
        <div className="schedule-detail-time"><CalendarDays size={15} /><span><strong>{scheduledDateLabel(item.scheduledAt)}</strong><small>{scheduledTimeLabel(item.scheduledAt)} · {state.preferences?.timezone ?? 'UTC'}</small></span></div>
        <div className="schedule-details-metadata"><div><span>CHANNEL</span><strong>{item.channel}</strong></div><div><span>PIPELINE</span><strong>{item.pipeline}</strong></div><div><span>CURRENT STATUS</span><strong>{item.status}</strong></div></div>
        {!rescheduling ? (
          <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Done</Button><Button variant="primary" icon={<CalendarClock size={14} />} onClick={() => setRescheduling(true)}>Reschedule</Button></div>
        ) : (
          <form noValidate aria-busy={submission.pending} className="schedule-reschedule-form" onChange={submission.clear} onSubmit={handleReschedule}><OperationFeedback result={submission.result} pending={submission.pending} /><fieldset className="editor-fields" disabled={submission.pending}>
            <h3>Choose a new upload time</h3><FieldError submission={submission} field="scheduledAt" />
            <div><label htmlFor="reschedule-date">Date</label><input id="reschedule-date" {...submission.fieldProps('scheduledAt')} type="date" className="text-input" value={date} onChange={(event) => setDate(event.target.value)} required /></div>
            <div><label htmlFor="reschedule-time">Time</label><input id="reschedule-time" {...submission.fieldProps('scheduledAt')} type="time" className="text-input" value={time} onChange={(event) => setTime(event.target.value)} required /></div>
            <div className="dialog-footer"><Button type="button" variant="secondary" onClick={() => setRescheduling(false)}>Cancel</Button><Button type="submit" variant="primary" icon={<Check size={14} />}>{submission.pending ? 'Saving…' : 'Save new time'}</Button></div>
          </fieldset></form>
        )}
        <p className="dialog-note">Rescheduling changes mock state only. No YouTube upload or schedule is created.</p>
      </section>
    </div>
  )
}

function SchedulerPage() {
  const { state, actions } = useStore()
  const timezone = state.preferences?.timezone ?? 'UTC'
  const items = useScheduledVideoRows()
  const canCreateSchedule = Array.from(state.content.values()).some(item => item.status === 'Ready' && !Array.from(state.scheduledVideos.values()).some(schedule => schedule.contentId === item.id))
  const channelRows = useChannelRows()
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined)
  const [channelFilter, setChannelFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [specificDate, setSpecificDate] = useState('')
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week')
  const [calendarAnchor, setCalendarAnchor] = useState(() => {
    return calendarDate(workspaceToday(timezone))
  })
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [rescheduledMessage, setRescheduledMessage] = useState('')

  const today = calendarDate(workspaceToday(timezone))
  const filteredItems = items.filter((item) => {
    if (channelFilter !== 'all' && item.channel !== channelFilter) return false
    const scheduledDay = calendarDate(item.scheduledAt)
    if (dateFilter === 'next-7-days' && (scheduledDay < today || scheduledDay > addCalendarDays(today, 6))) return false
    if (dateFilter === 'next-30-days' && (scheduledDay < today || scheduledDay > addCalendarDays(today, 29))) return false
    if (specificDate && item.scheduledAt.slice(0, 10) !== specificDate) return false
    return true
  }).sort((first, second) => first.scheduledAt.localeCompare(second.scheduledAt))

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const weekStart = getMonday(calendarAnchor)
  const calendarDays = calendarView === 'week'
    ? Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index))
    : (() => {
      const monthStart = new Date(Date.UTC(calendarAnchor.getUTCFullYear(), calendarAnchor.getUTCMonth(), 1, 12))
      const gridStart = getMonday(monthStart)
      return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index))
    })()
  const visibleCalendarItems = (day: Date) => filteredItems.filter((item) => item.scheduledAt.slice(0, 10) === calendarKey(day))
  const windowLabel = calendarView === 'week'
    ? `${scheduledDateLabel(localDateTime(weekStart, 12, 0), false)} – ${scheduledDateLabel(localDateTime(addCalendarDays(weekStart, 6), 12, 0), false)}`
    : new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(calendarAnchor)

  const navigateCalendar = (direction: -1 | 1) => {
    setCalendarAnchor((current) => calendarView === 'week'
      ? addCalendarDays(current, direction * 7)
      : new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + direction, 1, 12)))
  }

  const rescheduleItem = async (id: string, scheduledAt: string) => {
    const result = await actions.updateScheduledVideo(id, { scheduledAt })
    if (!result.ok) return result
    setRescheduledMessage('Upload time updated in this mock schedule.')
    setSelectedItemId(null)
    return result
  }

  const clearFilters = () => {
    setChannelFilter('all')
    setDateFilter('all')
    setSpecificDate('')
  }

  return (
    <>
      <PageHeading eyebrow="A RHYTHM THAT WORKS FOR YOU" title="Scheduler" action={<Button variant="primary" icon={<Plus size={16} />} disabled={!canCreateSchedule} title={!canCreateSchedule ? "Move an unscheduled content item to Ready first" : "Schedule ready content"} onClick={() => setEditingId(null)}>Create schedule</Button>} description="Plan upcoming uploads and see exactly when each channel is set to publish." />
      {!canCreateSchedule && <p className="disabled-action-note">To create a schedule, move an unscheduled content item to Ready in the Content library.</p>}
      <div className="scheduler-filter-toolbar">
        <label><span>Channel</span><Select aria-label="Filter schedule by channel" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}><option value="all">All channels</option>{channelRows.map((channel) => <option value={channel.name} key={channel.name}>{channel.name}</option>)}</Select></label>
        <label><span>Date range</span><Select aria-label="Filter schedule by date range" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">All dates</option><option value="next-7-days">Next 7 days</option><option value="next-30-days">Next 30 days</option></Select></label>
        <label><span>Specific date</span><input aria-label="Filter schedule by specific date" className="text-input" type="date" value={specificDate} onChange={(event) => setSpecificDate(event.target.value)} /></label>
        {(channelFilter !== 'all' || dateFilter !== 'all' || specificDate) && <Button variant="quiet" onClick={clearFilters}>Clear filters</Button>}
        <span className="scheduler-mock-tag"><Radio size={13} />Mock schedule</span>
      </div>
      {rescheduledMessage && <div className="content-created-message scheduler-notice" role="status"><CheckCircle2 size={15} />{rescheduledMessage}<button type="button" aria-label="Dismiss notification" onClick={() => setRescheduledMessage('')}><X size={15} /></button></div>}
      <div className="scheduler-layout">
        <section className="scheduler-calendar-section">
          <div className="scheduler-toolbar">
            <div className="calendar-month">
              <Button variant="secondary" iconOnly icon={<ChevronLeft size={15} />} aria-label="Previous calendar period" onClick={() => navigateCalendar(-1)} />
              <strong>{windowLabel}</strong>
              <Button variant="secondary" iconOnly icon={<ArrowRight size={15} />} aria-label="Next calendar period" onClick={() => navigateCalendar(1)} />
              <Button variant="quiet" onClick={() => setCalendarAnchor(new Date(today))}>Today</Button>
            </div>
            <div className="calendar-view" aria-label="Calendar view">
              <Button variant="quiet" className={calendarView === 'week' ? 'calendar-view-active' : ''} aria-pressed={calendarView === 'week'} onClick={() => setCalendarView('week')}>Week</Button>
              <Button variant="quiet" className={calendarView === 'month' ? 'calendar-view-active' : ''} aria-pressed={calendarView === 'month'} onClick={() => setCalendarView('month')}>Month</Button>
            </div>
          </div>
          <Card className={`calendar-card scheduler-calendar-card${calendarView === 'month' ? ' scheduler-month-calendar' : ''}`}>
            <div className="scheduler-calendar-grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => <div className="scheduler-weekday" key={weekday}>{weekday}</div>)}
              {calendarDays.map((day) => {
                const dayItems = visibleCalendarItems(day)
                const isToday = localDateKey(day) === localDateKey(today)
                const outsideMonth = day.getUTCMonth() !== calendarAnchor.getUTCMonth()
                return <div className={`scheduler-calendar-day${isToday ? ' scheduler-day-today' : ''}${outsideMonth && calendarView === 'month' ? ' scheduler-day-outside' : ''}`} key={localDateKey(day)}>
                  <div className="scheduler-calendar-day-number"><span>{day.getUTCDate()}</span>{dayItems.length > 0 && <small>{dayItems.length} upload{dayItems.length === 1 ? '' : 's'}</small>}</div>
                  <div className="scheduler-calendar-day-items">{dayItems.map((item) => <button className={`scheduler-calendar-event scheduler-event-${scheduleStatusTone[item.status]}`} key={item.id} onClick={() => setSelectedItemId(item.id)} aria-label={`${item.title}, ${scheduledTimeLabel(item.scheduledAt)}, ${item.status}`}>
                    <time>{scheduledTimeLabel(item.scheduledAt)}</time><strong>{item.title}</strong><small>{item.channel}</small>
                  </button>)}</div>
                </div>
              })}
            </div>
            {filteredItems.length === 0 && <div className="scheduler-calendar-empty">No scheduled uploads match these filters.</div>}
          </Card>
        </section>
        <Card className="scheduler-upcoming-panel">
          <SectionHeading title="Upcoming uploads" action={<Badge tone="blue">{filteredItems.length} scheduled</Badge>} />
          <p className="scheduler-panel-subtitle">Your next uploads, in publishing order.</p>
          {filteredItems.length > 0 ? <div className="scheduler-agenda-list">{filteredItems.slice(0, 6).map((item) => <button className="scheduler-agenda-item" key={item.id} onClick={() => setSelectedItemId(item.id)}>
            <div className="scheduler-agenda-date"><span>{formatWallTime(item.scheduledAt, { month: 'short' })}</span><strong>{Number(item.scheduledAt.slice(8, 10))}</strong></div>
            <div className="scheduler-agenda-copy"><strong>{item.title}</strong><span>{item.channel} · {scheduledTimeLabel(item.scheduledAt)}</span><Badge tone={scheduleStatusTone[item.status]} dot>{item.status}</Badge></div>
          </button>)}</div> : <EmptyState icon={<CalendarDays size={19} />} title="Nothing scheduled here" description="Try another channel or date range to see upcoming uploads." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />}
        </Card>
      </div>
      <div className="section-heading scheduler-cards-heading"><div><h2>Scheduled videos</h2><p>Open a card for details or move its planned upload time.</p></div><Badge tone="neutral">{filteredItems.length} items</Badge></div>
      {filteredItems.length > 0 ? <div className="scheduled-video-grid">{filteredItems.map((item) => <Card className="scheduled-video-card" key={item.id}>
        <VideoThumbnail kind={item.thumbnail} />
        <div className="scheduled-video-card-body">
          <div className="scheduled-video-card-title"><h3>{item.title}</h3><Badge tone={scheduleStatusTone[item.status]} dot>{item.status}</Badge></div>
          <p className="scheduled-video-channel">{item.channel}</p>
          <div className="scheduled-video-meta"><span><Workflow size={13} />{item.pipeline}</span><span><CalendarClock size={13} />{scheduledDateLabel(item.scheduledAt)} · {scheduledTimeLabel(item.scheduledAt)}</span></div>
          <div className="scheduled-video-card-actions"><Button variant="quiet" onClick={() => setEditingId(item.id)}>Edit</Button><Button variant="quiet" onClick={() => actions.requestDelete('schedule', item.id)}>Delete</Button><Button variant="quiet" onClick={() => setSelectedItemId(item.id)}>Details</Button><Button variant="secondary" icon={<CalendarClock size={13} />} onClick={() => setSelectedItemId(item.id)}>Reschedule</Button></div>
        </div>
      </Card>)}</div> : <EmptyState icon={<Video size={21} />} title="No scheduled videos" description="There are no mock uploads matching your current filters." />}
      <JobQueuePanel />
      {editingId !== undefined && <ScheduleEditor scheduleId={editingId ?? undefined} onClose={() => setEditingId(undefined)} />}
      {selectedItem && <SchedulerDetailsDialog item={selectedItem} onClose={() => setSelectedItemId(null)} onReschedule={rescheduleItem} />}
    </>
  )
}

type AnalyticsVideo = {
  id: string
  title: string
  channel: string
  pipeline: string
  contentType: 'Long-form' | 'Short'
  publishedAt: string
  thumbnail: string
  views: number
  watchTimeHours: number
  averageDurationSeconds: number
  engagementRate: number
  subscribersGained: number
}

const analyticsReferenceTime = Date.now()

type AnalyticsRange = '7' | '30' | '90'
type PerformanceBucket = { label: string; views: number }

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatWatchTime(hours: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(hours)} hrs`
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return minutes ? `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s` : `${remainingSeconds}s`
}

function buildPerformanceSeries(videos: AnalyticsVideo[], range: AnalyticsRange): PerformanceBucket[] {
  const bucketCount = range === '7' ? 7 : range === '30' ? 10 : 12
  const rangeDays = Number(range)
  const bucketDays = rangeDays / bucketCount
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketDate = new Date()
    bucketDate.setDate(bucketDate.getDate() - Math.floor((bucketCount - index - 1) * bucketDays))
    return { date: bucketDate, label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(bucketDate), views: 0 }
  })
  videos.forEach((video) => {
    const ageDays = Math.floor((analyticsReferenceTime - new Date(`${video.publishedAt}T23:59:59`).getTime()) / 86400000)
    if (ageDays < 0 || ageDays >= rangeDays) return
    const index = Math.min(bucketCount - 1, Math.floor((rangeDays - ageDays - 1) / bucketDays))
    buckets[index].views += video.views
  })
  return buckets
}

function AnalyticsPage() {
  const analyticsVideos = useAnalyticsRows()
  const channelRows = useChannelRows()
  const initialPipelines = usePipelineRows()
  const [channelFilter, setChannelFilter] = useState('all')
  const [dateRange, setDateRange] = useState<AnalyticsRange>('30')
  const [contentTypeFilter, setContentTypeFilter] = useState('all')
  const [pipelineFilter, setPipelineFilter] = useState('all')

  const filteredVideos = analyticsVideos.filter((video) => {
    const ageDays = (analyticsReferenceTime - new Date(`${video.publishedAt}T23:59:59`).getTime()) / 86400000
    return (channelFilter === 'all' || video.channel === channelFilter)
      && (contentTypeFilter === 'all' || video.contentType === contentTypeFilter)
      && (pipelineFilter === 'all' || video.pipeline === pipelineFilter)
      && ageDays >= 0 && ageDays < Number(dateRange)
  })

  const totals = filteredVideos.reduce((total, video) => ({
    views: total.views + video.views,
    watchTimeHours: total.watchTimeHours + video.watchTimeHours,
    durationWeighted: total.durationWeighted + video.averageDurationSeconds * video.views,
    engagementWeighted: total.engagementWeighted + video.engagementRate * video.views,
    subscribersGained: total.subscribersGained + video.subscribersGained,
  }), { views: 0, watchTimeHours: 0, durationWeighted: 0, engagementWeighted: 0, subscribersGained: 0 })
  const averageDuration = totals.views ? totals.durationWeighted / totals.views : 0
  const engagementRate = totals.views ? totals.engagementWeighted / totals.views : 0
  const performance = buildPerformanceSeries(filteredVideos, dateRange)
  const maxViews = Math.max(1, ...performance.map((bucket) => bucket.views))
  const graphPoints = performance.map((bucket, index) => ({
    x: performance.length > 1 ? index * (1000 / (performance.length - 1)) : 500,
    y: 220 - bucket.views / maxViews * 180,
  }))
  const linePath = graphPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ')
  const areaPath = graphPoints.length ? `${linePath} L${graphPoints[graphPoints.length - 1].x} 240 L${graphPoints[0].x} 240 Z` : ''
  const visibleChannels = channelRows.filter((channel) => channelFilter === 'all' || channel.name === channelFilter)
  const channelMetrics = visibleChannels.map((channel) => {
    const videos = filteredVideos.filter((video) => video.channel === channel.name)
    const views = videos.reduce((total, video) => total + video.views, 0)
    return {
      ...channel,
      views,
      subscribers: videos.reduce((total, video) => total + video.subscribersGained, 0),
      watchTimeHours: videos.reduce((total, video) => total + video.watchTimeHours, 0),
      engagement: views ? videos.reduce((total, video) => total + video.engagementRate * video.views, 0) / views : 0,
    }
  })
  const pipelineMetrics = initialPipelines.map((pipeline) => {
    const videos = filteredVideos.filter((video) => video.pipeline === pipeline.name)
    return { name: pipeline.name, views: videos.reduce((total, video) => total + video.views, 0), count: videos.length }
  }).filter((pipeline) => pipeline.count > 0)
  const maxPipelineViews = Math.max(1, ...pipelineMetrics.map((pipeline) => pipeline.views))
  const averagePrevious = 'No period comparison available'

  return (
    <>
      <PageHeading eyebrow="PERFORMANCE · MOCK DATA" title="Analytics" description="Understand how your content is performing across channels, formats, and pipelines." />
      <Card className="analytics-preview-banner"><span className="notice-icon"><Activity size={17} /></span><div><strong>Mock analytics preview</strong><p>All metrics and charts below are illustrative sample data. No YouTube Analytics connection is active.</p></div><Badge tone="violet">Sample data</Badge></Card>
      <div className="analytics-filters">
        <label><span>Channel</span><Select aria-label="Analytics channel" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}><option value="all">All channels</option>{channelRows.map((channel) => <option key={channel.id} value={channel.name}>{channel.name}</option>)}</Select></label>
        <label><span>Date range</span><Select aria-label="Analytics date range" value={dateRange} onChange={(event) => {
          if (event.target.value === '7' || event.target.value === '30' || event.target.value === '90') setDateRange(event.target.value)
        }}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select></label>
        <label><span>Content type</span><Select aria-label="Analytics content type" value={contentTypeFilter} onChange={(event) => setContentTypeFilter(event.target.value)}><option value="all">All formats</option><option value="Long-form">Long-form</option><option value="Short">Shorts</option></Select></label>
        <label><span>Pipeline</span><Select aria-label="Analytics pipeline" value={pipelineFilter} onChange={(event) => setPipelineFilter(event.target.value)}><option value="all">All pipelines</option>{initialPipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.name}>{pipeline.name}</option>)}</Select></label>
      </div>
      <div className="stat-grid analytics-stat-grid">
        <StatCard label="Views" value={formatCompactNumber(totals.views)} change={`${filteredVideos.length} videos in range`} changeTone="neutral" icon={<Eye size={18} />} />
        <StatCard label="Watch time" value={formatWatchTime(totals.watchTimeHours)} change="Across filtered videos" changeTone="neutral" icon={<Clock3 size={18} />} tone="blue" />
        <StatCard label="Avg. view duration" value={formatDuration(averageDuration)} change="Weighted by video views" changeTone="neutral" icon={<CirclePlay size={18} />} tone="amber" />
        <StatCard label="Engagement" value={`${engagementRate.toFixed(1)}%`} change="Mock interaction rate" changeTone="neutral" icon={<ThumbsUp size={18} />} tone="green" />
        <StatCard label="Subscribers gained" value={`+${totals.subscribersGained}`} change="From these videos" changeTone="neutral" icon={<Radio size={18} />} />
        <StatCard label="Videos published" value={String(filteredVideos.length)} change={`Last ${dateRange} days`} changeTone="neutral" icon={<Video size={18} />} tone="blue" />
      </div>

      <Card className="analytics-chart-card analytics-performance-card">
        <div className="card-heading-row"><div><p className="card-kicker">PERFORMANCE OVER TIME</p><h2>Views across your selected period</h2><p className="card-subtitle">{channelFilter === 'all' ? 'All channels' : channelFilter} · Last {dateRange} days · {filteredVideos.length} mock videos</p></div><Badge tone="neutral">{averagePrevious}</Badge></div>
        {filteredVideos.length > 0 ? <>
          <div className="analytics-chart"><div className="analytics-y-labels"><span>{formatCompactNumber(maxViews)}</span><span>{formatCompactNumber(maxViews * .75)}</span><span>{formatCompactNumber(maxViews * .5)}</span><span>{formatCompactNumber(maxViews * .25)}</span><span>0</span></div><div className="analytics-plot"><div className="chart-grid-lines"><i /><i /><i /><i /><i /></div><svg className="line-chart analytics-performance-svg" viewBox="0 0 1000 250" preserveAspectRatio="none" role="img" aria-label={`Mock views over the last ${dateRange} days`}>{areaPath && <path d={areaPath} fill="url(#analyticsFill)" />}<defs><linearGradient id="analyticsFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6558df" stopOpacity=".18" /><stop offset="100%" stopColor="#6558df" stopOpacity="0" /></linearGradient></defs>{linePath && <path d={linePath} fill="none" stroke="#6558df" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}</svg><div className="chart-x-labels">{performance.filter((_, index) => index % Math.max(1, Math.ceil(performance.length / 5)) === 0).map((bucket) => <span key={bucket.label}>{bucket.label}</span>)}</div></div></div>
          <div className="chart-legend"><span><i className="legend-dot legend-violet" />Views per interval</span><span><i className="legend-dot legend-gray" />Mock data</span></div>
        </> : <EmptyState icon={<Activity size={20} />} title="No performance data for these filters" description="Try a wider date range or different channel, format, or pipeline." action={<Button variant="secondary" onClick={() => { setChannelFilter('all'); setDateRange('90'); setContentTypeFilter('all'); setPipelineFilter('all') }}>Reset filters</Button>} />}
      </Card>

      <div className="analytics-insight-grid">
        <Card className="analytics-comparison-card">
          <SectionHeading title="Channel comparison" action={<Badge tone="neutral">Views</Badge>} />
          <p className="analytics-panel-description">Filtered views and subscriber gains by channel.</p>
          {channelMetrics.length > 0 ? <div className="analytics-channel-comparison">{channelMetrics.map((channel) => <div className="analytics-channel-comparison-row" key={channel.name}>
            <div className="analytics-comparison-label"><Avatar initials={channel.initials} className={channel.color} /><div><strong>{channel.name}</strong><span>{formatCompactNumber(channel.views)} views · +{channel.subscribers} subs</span></div></div>
            <div className="analytics-comparison-track"><i className={channel.name === 'Creative Growth' ? 'comparison-purple' : 'comparison-green'} style={{ width: `${Math.max(0, channel.views / Math.max(1, ...channelMetrics.map((entry) => entry.views)) * 100)}%` }} /></div>
            <strong className="analytics-comparison-value">{formatCompactNumber(channel.views)}</strong>
          </div>)}</div> : <EmptyState icon={<Radio size={18} />} title="No channel data" description="Try changing the selected filters." />}
        </Card>
        <Card className="analytics-pipeline-card">
          <SectionHeading title="Content by pipeline" action={<Workflow size={15} />} />
          <p className="analytics-panel-description">Views and video count for each workflow.</p>
          {pipelineMetrics.length > 0 ? <div className="analytics-pipeline-list">{pipelineMetrics.map((pipeline) => <div className="analytics-pipeline-row" key={pipeline.name}><div><strong>{pipeline.name}</strong><span>{pipeline.count} video{pipeline.count === 1 ? '' : 's'} · {formatCompactNumber(pipeline.views)} views</span></div><div className="analytics-pipeline-track"><i style={{ width: `${pipeline.views / maxPipelineViews * 100}%` }} /></div></div>)}</div> : <EmptyState icon={<Workflow size={18} />} title="No pipeline data" description="Try changing the selected filters." />}
        </Card>
      </div>

      <Card className="analytics-video-table-card">
        <div className="analytics-table-title"><div><SectionHeading title="Individual video performance" /><p className="analytics-panel-description">Performance metrics for published mock videos in this selection.</p></div><Badge tone="neutral">{filteredVideos.length} videos</Badge></div>
        {filteredVideos.length > 0 ? <div className="analytics-table-scroll"><table className="analytics-video-table"><thead><tr><th>VIDEO</th><th>CHANNEL</th><th>PIPELINE</th><th>VIEWS</th><th>WATCH TIME</th><th>AVG. DURATION</th><th>ENGAGEMENT</th><th>SUBS</th></tr></thead><tbody>{[...filteredVideos].sort((a, b) => b.views - a.views).map((video) => <tr key={video.id}>
          <td><div className="analytics-video-name"><VideoThumbnail kind={video.thumbnail} compact /><span><strong>{video.title}</strong><small>{video.contentType} · Published {scheduledDateLabel(`${video.publishedAt}T12:00:00`, false)}</small></span></div></td>
          <td>{video.channel}</td><td>{video.pipeline}</td><td><strong>{formatCompactNumber(video.views)}</strong></td><td>{video.watchTimeHours} hrs</td><td>{formatDuration(video.averageDurationSeconds)}</td><td>{video.engagementRate.toFixed(1)}%</td><td className="positive-value">+{video.subscribersGained}</td>
        </tr>)}</tbody></table></div> : <EmptyState icon={<Video size={19} />} title="No videos match these filters" description="Try a different combination to see video performance." />}
      </Card>
      <p className="analytics-data-footer"><Activity size={13} />Analytics values are sample data for the Phase 1 interface preview.</p>
    </>
  )
}

type SettingsValues = {
  workspaceName: string
  timezone: string
  language: string
  appearance: string
  compactDensity: boolean
  reducedMotion: boolean
  notifyPipeline: boolean
  notifyPublishing: boolean
  notifyWarnings: boolean
  weeklyDigest: string
  defaultChannel: string
  defaultVisibility: string
  defaultPublishTime: string
  defaultPipeline: string
  textProvider: string
  voiceProvider: string
  imageProvider: string
}

const initialSettings: SettingsValues = {
  workspaceName: 'Northstar Studio',
  timezone: 'Asia/Colombo',
  language: 'en-US',
  appearance: 'light',
  compactDensity: false,
  reducedMotion: false,
  notifyPipeline: true,
  notifyPublishing: true,
  notifyWarnings: true,
  weeklyDigest: 'monday',
  defaultChannel: 'channel-1',
  defaultVisibility: 'private',
  defaultPublishTime: '09:30',
  defaultPipeline: 'pipeline-long-form',
  textProvider: 'provider-openai',
  voiceProvider: '',
  imageProvider: '',
}

function settingsFromPreferences(preferences: UserPreferences | null): SettingsValues {
  return { ...initialSettings, ...preferences, defaultChannel: preferences?.defaultChannelId ?? '', defaultPipeline: preferences?.defaultPipelineId ?? '', textProvider: preferences?.textProviderId ?? '', voiceProvider: preferences?.voiceProviderId ?? '', imageProvider: preferences?.imageProviderId ?? '' }
}

const settingsSections = [
  { id: 'settings-general', label: 'General', icon: Settings2 },
  { id: 'settings-appearance', label: 'Appearance', icon: Palette },
  { id: 'settings-notifications', label: 'Notifications', icon: Bell },
  { id: 'settings-publishing', label: 'Publishing', icon: CalendarClock },
  { id: 'settings-pipeline', label: 'Default pipeline', icon: Workflow },
  { id: 'settings-ai', label: 'AI preferences', icon: Sparkles },
  { id: 'settings-account', label: 'Account & security', icon: ShieldCheck },
]

function SettingsPage() {
  const { state, actions, remote } = useStore()
  const auth = useOptionalAuth()
  const channelRows = useChannelRows()
  const initialPipelines = usePipelineRows()
  const initialProviders = useProviderRows()
  const preferences = state.preferences
  const submission = useSubmission()
  const [settings, setSettings] = useState<SettingsValues>(() => settingsFromPreferences(preferences))
  const [savedMessage, setSavedMessage] = useState('')
  const [activeSection, setActiveSection] = useState(() => {
    const initialHash = window.location.hash.slice(1)
    return settingsSections.find(({ id }) => id === initialHash)?.id ?? settingsSections[0].id
  })
  const updateSetting = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
    setSavedMessage(''); submission.clear()
  }
  const saveSettings = () => {
    setSavedMessage('')
    void submission.submit(() => actions.updatePreferences({ workspaceName: settings.workspaceName.trim(), timezone: settings.timezone, language: settings.language, appearance: settings.appearance as UserPreferences['appearance'], compactDensity: settings.compactDensity, reducedMotion: settings.reducedMotion, notifyPipeline: settings.notifyPipeline, notifyPublishing: settings.notifyPublishing, notifyWarnings: settings.notifyWarnings, weeklyDigest: settings.weeklyDigest as UserPreferences['weeklyDigest'], defaultVisibility: settings.defaultVisibility as UserPreferences['defaultVisibility'], defaultPublishTime: settings.defaultPublishTime, defaultChannelId: settings.defaultChannel || null, defaultPipelineId: settings.defaultPipeline || null, textProviderId: settings.textProvider || null, voiceProviderId: settings.voiceProvider || null, imageProviderId: settings.imageProvider || null }))
  }
  const enabledProviders = initialProviders

  return (
    <>
      <PageHeading eyebrow="MAKE YOURSELF AT HOME" title="Settings" description="Set workspace defaults and preferences for your creative workflow." action={<Button variant="primary" icon={<Save size={15} />} onClick={saveSettings} disabled={submission.pending}>{submission.pending ? 'Saving…' : 'Save preferences'}</Button>} />
      <Card className="settings-preview-banner"><span className="notice-icon"><Lightbulb size={17} /></span><div><strong>{remote ? 'Account workspace' : 'Browser workspace'}</strong><p>{remote ? 'Changes are saved to your authenticated backend account. Browser backups remain separate until you explicitly import them.' : 'Workspace changes are saved in this browser when storage is available. No account or external service is connected.'}</p></div><Button variant="secondary" onClick={actions.requestReset}>Reset workspace</Button></Card>
      {savedMessage && <div className="content-created-message settings-saved-message" role="status"><CheckCircle2 size={15} />{savedMessage}<button type="button" aria-label="Dismiss notification" onClick={() => setSavedMessage('')}><X size={15} /></button></div>}
      <OperationFeedback result={submission.result} pending={submission.pending} /><fieldset className="editor-fields" disabled={submission.pending}><div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">{settingsSections.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} onClick={() => setActiveSection(id)} className={activeSection === id ? 'settings-nav-active' : undefined} aria-current={activeSection === id ? 'location' : undefined}><Icon size={15} /><span>{label}</span></a>)}</nav>
        <div className="settings-groups">
          <Card className="settings-card" id="settings-general">
            <div className="settings-card-heading"><span><Settings2 size={17} /></span><div><h2>General</h2><p>Workspace details and localization defaults.</p></div></div>
            <div className="settings-fields">
              <label className="settings-field" htmlFor="settings-workspace"><span>Workspace name</span><input id="settings-workspace" className="text-input" {...submission.fieldProps('workspaceName')} value={settings.workspaceName} onChange={(event) => updateSetting('workspaceName', event.target.value)} maxLength={80} /><FieldError submission={submission} field="workspaceName" /></label>
              <label className="settings-field" htmlFor="settings-timezone"><span>Timezone</span><Select id="settings-timezone" {...submission.fieldProps('timezone')} value={settings.timezone} onChange={(event) => updateSetting('timezone', event.target.value)}><option value="Asia/Colombo">Sri Lanka Standard Time</option><option value="America/Los_Angeles">Pacific Time</option><option value="America/Denver">Mountain Time</option><option value="America/Chicago">Central Time</option><option value="America/New_York">Eastern Time</option><option value="Europe/London">London</option><option value="Asia/Kolkata">India Standard Time</option><option value="UTC">UTC</option></Select><FieldError submission={submission} field="timezone" /></label>
              <label className="settings-field" htmlFor="settings-language"><span>Default language</span><Select id="settings-language" {...submission.fieldProps('language')} value={settings.language} onChange={(event) => updateSetting('language', event.target.value)}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="es">Spanish</option><option value="fr">French</option></Select><FieldError submission={submission} field="language" /></label>
            </div>
          </Card>
          <Card className="settings-card" id="settings-appearance">
            <div className="settings-card-heading"><span><Palette size={17} /></span><div><h2>Appearance</h2><p>Choose how the Content Hub workspace should look.</p></div></div>
            <div className="settings-fields">
              <label className="settings-field" htmlFor="settings-theme"><span>Color theme</span><Select id="settings-theme" {...submission.fieldProps('appearance')} value={settings.appearance} onChange={(event) => updateSetting('appearance', event.target.value)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">Use system preference</option></Select><FieldError submission={submission} field="appearance" /></label>
              <label className="settings-toggle-row"><span><strong>Compact density</strong><small>Reduce spacing in tables and lists. Applies after saving.</small></span><input type="checkbox" checked={settings.compactDensity} onChange={(event) => updateSetting('compactDensity', event.target.checked)} /></label>
              <label className="settings-toggle-row"><span><strong>Reduce motion</strong><small>Prefer fewer animated transitions. Applies after saving.</small></span><input type="checkbox" checked={settings.reducedMotion} onChange={(event) => updateSetting('reducedMotion', event.target.checked)} /></label>
            </div>
            <div className="settings-appearance-note"><Sun size={14} /><Monitor size={14} />Saved appearance and accessibility preferences apply across the workspace.</div>
          </Card>
          <Card className="settings-card" id="settings-notifications">
            <div className="settings-card-heading"><span><Bell size={17} /></span><div><h2>Notifications</h2><p>Choose which workspace updates you would like to receive.</p></div></div>
            <div className="settings-fields">
              <label className="settings-toggle-row"><span><strong>Pipeline progress</strong><small>Mock notifications when a content item changes stage.</small></span><input type="checkbox" checked={settings.notifyPipeline} onChange={(event) => updateSetting('notifyPipeline', event.target.checked)} /></label>
              <label className="settings-toggle-row"><span><strong>Publishing updates</strong><small>Mock updates when an upload is ready or published.</small></span><input type="checkbox" checked={settings.notifyPublishing} onChange={(event) => updateSetting('notifyPublishing', event.target.checked)} /></label>
              <label className="settings-toggle-row"><span><strong>Warnings and failures</strong><small>Bring attention to mock workflow issues that need review.</small></span><input type="checkbox" checked={settings.notifyWarnings} onChange={(event) => updateSetting('notifyWarnings', event.target.checked)} /></label>
              <label className="settings-field" htmlFor="settings-digest"><span>Weekly channel digest</span><Select id="settings-digest" {...submission.fieldProps('weeklyDigest')} value={settings.weeklyDigest} onChange={(event) => updateSetting('weeklyDigest', event.target.value)}><option value="never">Never</option><option value="monday">Every Monday</option><option value="friday">Every Friday</option></Select><FieldError submission={submission} field="weeklyDigest" /></label>
            </div>
          </Card>
          <Card className="settings-card" id="settings-publishing">
            <div className="settings-card-heading"><span><CalendarClock size={17} /></span><div><h2>Default publishing preferences</h2><p>Starting values for new content. These settings do not schedule real uploads.</p></div></div>
            <div className="settings-fields">
              <label className="settings-field" htmlFor="settings-channel"><span>Default channel</span><Select id="settings-channel" {...submission.fieldProps('defaultChannelId')} value={settings.defaultChannel} onChange={(event) => updateSetting('defaultChannel', event.target.value)}><option value="">No default channel</option>{channelRows.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</Select><FieldError submission={submission} field="defaultChannelId" /></label>
              <label className="settings-field" htmlFor="settings-visibility"><span>Default visibility</span><Select id="settings-visibility" {...submission.fieldProps('defaultVisibility')} value={settings.defaultVisibility} onChange={(event) => updateSetting('defaultVisibility', event.target.value)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></Select><FieldError submission={submission} field="defaultVisibility" /></label>
              <label className="settings-field" htmlFor="settings-publish-time"><span>Preferred publish time</span><input id="settings-publish-time" className="text-input" type="time" {...submission.fieldProps('defaultPublishTime')} value={settings.defaultPublishTime} onChange={(event) => updateSetting('defaultPublishTime', event.target.value)} /><FieldError submission={submission} field="defaultPublishTime" /></label>
            </div>
            <p className="settings-inline-note"><AlertTriangle size={13} />Publishing defaults are a UI preview and are not sent to YouTube.</p>
          </Card>
          <Card className="settings-card" id="settings-pipeline">
            <div className="settings-card-heading"><span><Workflow size={17} /></span><div><h2>Default pipeline</h2><p>Choose the workflow preselected for new content ideas.</p></div></div>
            <div className="settings-fields"><label className="settings-field" htmlFor="settings-default-pipeline"><span>Pipeline for new content</span><Select id="settings-default-pipeline" {...submission.fieldProps('defaultPipelineId')} value={settings.defaultPipeline} onChange={(event) => updateSetting('defaultPipeline', event.target.value)}><option value="">No default pipeline</option>{initialPipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id} disabled={!pipeline.enabled}>{pipeline.name}{pipeline.enabled ? '' : ' · disabled mock'}</option>)}</Select><FieldError submission={submission} field="defaultPipelineId" /></label></div>
            <div className="settings-pipeline-preview"><Workflow size={15} /><span>Selected pipeline</span><strong>{initialPipelines.find((pipeline) => pipeline.id === settings.defaultPipeline)?.name ?? 'No pipeline selected'}</strong></div>
          </Card>
          <Card className="settings-card" id="settings-ai">
            <div className="settings-card-heading"><span><Sparkles size={17} /></span><div><h2>AI provider preferences</h2><p>Mock defaults for provider categories used by future pipeline steps.</p></div></div>
            <div className="settings-fields">
              <label className="settings-field" htmlFor="settings-text-provider"><span>Text generation</span><Select id="settings-text-provider" {...submission.fieldProps('textProviderId')} value={settings.textProvider} onChange={(event) => updateSetting('textProvider', event.target.value)}><option value="">No default provider</option>{enabledProviders.filter((provider) => provider.category === 'Text generation').map((provider) => <option value={provider.id} key={provider.id} disabled={!provider.enabled}>{provider.name}</option>)}</Select><FieldError submission={submission} field="textProviderId" /></label>
              <label className="settings-field" htmlFor="settings-voice-provider"><span>Text-to-speech</span><Select id="settings-voice-provider" {...submission.fieldProps('voiceProviderId')} value={settings.voiceProvider} onChange={(event) => updateSetting('voiceProvider', event.target.value)}><option value="">No default provider</option>{initialProviders.filter((provider) => provider.category === 'Text-to-speech').map((provider) => <option value={provider.id} key={provider.id} disabled={!provider.enabled}>{provider.name}{provider.enabled ? '' : ' · disabled mock'}</option>)}</Select><FieldError submission={submission} field="voiceProviderId" /></label>
              <label className="settings-field" htmlFor="settings-image-provider"><span>Image generation</span><Select id="settings-image-provider" {...submission.fieldProps('imageProviderId')} value={settings.imageProvider} onChange={(event) => updateSetting('imageProvider', event.target.value)}><option value="">No default provider</option>{initialProviders.filter((provider) => provider.category === 'Image generation').map((provider) => <option value={provider.id} key={provider.id} disabled={!provider.enabled}>{provider.name}{provider.enabled ? '' : ' · disabled mock'}</option>)}</Select><FieldError submission={submission} field="imageProviderId" /></label>
            </div>
            <p className="settings-inline-note"><Sparkles size={13} />These are preferred provider labels only; no AI provider is called.</p>
          </Card>
          <Card className="settings-card" id="settings-account">
            <div className="settings-card-heading"><span><ShieldCheck size={17} /></span><div><h2>Account & security</h2><p>{remote ? 'Authenticated with a secure backend cookie session.' : 'Account controls shown for interface completeness. No authentication is active.'}</p></div></div>
            <div className="settings-account-summary"><Avatar initials={auth?.user?.displayName.slice(0, 2).toUpperCase() ?? 'JD'} className="channel-purple" /><div><strong>{auth?.user?.displayName ?? 'Jordan Davis'}</strong><span><Mail size={12} />{auth?.user?.email ?? 'jordan@example.com'}</span></div><Badge tone="neutral">{remote ? 'Signed in' : 'Preview account'}</Badge></div>
            <div className="settings-security-rows">
              <div><span className="settings-security-icon"><LockKeyhole size={15} /></span><span><strong>Password & sign-in</strong><small>{remote ? 'Password changes are supported by the backend API; this settings form is not connected yet.' : 'Password management is not available in this UI-only phase.'}</small></span><Button variant="secondary" disabled>Unavailable</Button></div>
              <div><span className="settings-security-icon"><ShieldCheck size={15} /></span><span><strong>Two-factor authentication</strong><small>Security setup requires a future authentication service.</small></span><Button variant="secondary" disabled>Not configured</Button></div>
              <div><span className="settings-security-icon"><Radio size={15} /></span><span><strong>Active sessions</strong><small>{remote ? 'Your session is tracked by the backend and expires after inactivity.' : 'Session management is a placeholder; no sessions are tracked.'}</small></span><Button variant="secondary" disabled={!auth} onClick={() => void submission.submit(async () => { try { await auth?.logout(); return { ok: true, message: 'Signed out.' } } catch (error) { return { ok: false, kind: 'failure', message: error instanceof Error ? error.message : 'Could not sign out.', errors: {} } } })}>{remote ? 'Sign out' : 'Preview only'}</Button></div>
            </div>
          </Card>
        </div>
      </div>
      </fieldset><div className="settings-bottom-actions"><span><CheckCircle2 size={14} />Unsaved changes stay in this page only.</span><Button variant="quiet" icon={<RotateCcw size={14} />} disabled={submission.pending} onClick={() => { setSettings(settingsFromPreferences(preferences)); submission.clear(); setSavedMessage('Unsaved changes reset to the saved workspace preferences.') }}>Reset unsaved changes</Button><Button variant="primary" icon={<Save size={14} />} onClick={saveSettings} disabled={submission.pending}>{submission.pending ? 'Saving…' : 'Save preferences'}</Button></div>
    </>
  )
}

export { ChannelDetailsDialog, ProviderDialog, PipelineBuilderDialog, SchedulerDetailsDialog, AnalyticsPage, ChannelsPage, ContentPage, DashboardPage, ProvidersPage, SchedulerPage, SettingsPage, WorkflowsPage }
