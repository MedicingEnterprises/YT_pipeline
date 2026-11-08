/**
 * Mock data initialization for the YouTube automation application.
 * This file contains sample data that matches the domain models.
 */

import type {
  Channel,
  AIProvider,
  ContentItem,
  Pipeline,
  ScheduledVideo,
  UserPreferences,
  AnalyticsVideo,
  Activity,
  PipelineStep,
  ContentStatus,
  ScheduleStatus,
  PipelineStepKind,
  ActivityCategory,
  ActivityTone,
} from '../models'
import { addDays, workspaceToday } from './time.ts'

// ============================================================================
// TIMESTAMP UTILITIES
// ============================================================================

const referenceTime = Date.now()

function dateOffset(days: number): string {
  const date = new Date(referenceTime)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function dateTimeOffset(days: number, hour: number, minute: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${addDays(workspaceToday('Asia/Colombo', new Date(referenceTime)), days)}T${pad(hour)}:${pad(minute)}`
}

// ============================================================================
// MOCK CHANNELS
// ============================================================================

const mockChannels: Channel[] = [
  {
    id: 'channel-1',
    name: 'Creative Growth',
    handle: '@creativegrowth',
    category: 'Personal development',
    subscribers: '24.8k',
    videos: '78',
    initials: 'CG',
    color: 'channel-purple',
    status: 'connected',
    recentActivity: 'Video published',
    activityTime: '2 hours ago',
    scheduleDays: 'Monday · Wednesday · Friday',
    scheduleTime: '9:30 AM',
    scheduledCount: 2,
    publishedCount: 78,
    defaultPipelineId: 'pipeline-long-form',
    recentUploads: [
      { id: 'upload-1', title: 'The 5-minute reset that changed my mornings', status: 'Published', date: 'Today · 9:30 AM', tone: 'green' },
      { id: 'upload-2', title: 'The creative reset', status: 'Scheduled', date: 'Sep 30 · 9:30 AM', tone: 'blue' },
      { id: 'upload-3', title: 'Stop overthinking. Start creating.', status: 'In review', date: 'Sep 24', tone: 'amber' },
    ],
    createdAt: dateOffset(-365),
    updatedAt: dateOffset(0),
  },
  {
    id: 'channel-2',
    name: 'Mindful Minutes',
    handle: '@mindfulminutes',
    category: 'Wellness & lifestyle',
    subscribers: '18.2k',
    videos: '50',
    initials: 'MM',
    color: 'channel-green',
    status: 'connected',
    recentActivity: 'Upload scheduled',
    activityTime: 'Yesterday',
    scheduleDays: 'Tuesday · Friday',
    scheduleTime: '11:00 AM',
    scheduledCount: 1,
    publishedCount: 50,
    defaultPipelineId: 'pipeline-shorts',
    recentUploads: [
      { id: 'upload-4', title: 'A calmer way to plan your week', status: 'Scheduled', date: 'Sep 27 · 11:00 AM', tone: 'blue' },
      { id: 'upload-5', title: 'Make room for better ideas', status: 'Ready', date: 'Oct 2 · 11:00 AM', tone: 'amber' },
      { id: 'upload-6', title: 'Build a life you don\'t need a break from', status: 'Published', date: 'Sep 20', tone: 'green' },
    ],
    createdAt: dateOffset(-365),
    updatedAt: dateOffset(-1),
  },
  {
    id: 'channel-3',
    name: 'Studio Notes',
    handle: '@studionotes',
    category: 'Creator education',
    subscribers: '—',
    videos: '—',
    initials: 'SN',
    color: 'channel-orange',
    status: 'disconnected',
    recentActivity: 'Connect this channel to get started',
    activityTime: 'No recent activity',
    scheduleDays: 'Not set',
    scheduleTime: 'Not set',
    scheduledCount: 0,
    publishedCount: 0,
    defaultPipelineId: null,
    recentUploads: [],
    createdAt: dateOffset(-30),
    updatedAt: dateOffset(-30),
  },
]

// ============================================================================
// MOCK AI PROVIDERS
// ============================================================================

const mockProviders: AIProvider[] = [
  {
    id: 'provider-openai',
    name: 'OpenAI',
    category: 'Text generation',
    connected: true,
    enabled: true,
    models: ['GPT-4o', 'GPT-4o mini'],
    lastUsed: 'Today, 10:42 AM',
    createdAt: dateOffset(-60),
    updatedAt: dateOffset(0),
  },
  {
    id: 'provider-anthropic',
    name: 'Anthropic',
    category: 'Text generation',
    connected: true,
    enabled: true,
    models: ['Claude 3.7 Sonnet', 'Claude 3.5 Haiku'],
    lastUsed: 'Today, 9:18 AM',
    createdAt: dateOffset(-60),
    updatedAt: dateOffset(0),
  },
  {
    id: 'provider-elevenlabs',
    name: 'ElevenLabs',
    category: 'Text-to-speech',
    connected: true,
    enabled: false,
    models: ['Eleven Multilingual v2'],
    lastUsed: 'Sep 24, 2026',
    createdAt: dateOffset(-45),
    updatedAt: dateOffset(-3),
  },
  {
    id: 'provider-stability',
    name: 'Stability AI',
    category: 'Image generation',
    connected: false,
    enabled: false,
    models: ['Stable Diffusion XL', 'Stable Image Ultra'],
    lastUsed: 'Never',
    createdAt: dateOffset(-30),
    updatedAt: dateOffset(-30),
  },
  {
    id: 'provider-runway',
    name: 'Runway',
    category: 'Video generation',
    connected: false,
    enabled: false,
    models: ['Gen-3 Alpha', 'Gen-3 Turbo'],
    lastUsed: 'Never',
    createdAt: dateOffset(-30),
    updatedAt: dateOffset(-30),
  },
  {
    id: 'provider-voyage',
    name: 'Voyage AI',
    category: 'Embeddings / analysis',
    connected: true,
    enabled: true,
    models: ['Voyage 3', 'Voyage 3 Lite'],
    lastUsed: 'Sep 25, 2026',
    createdAt: dateOffset(-60),
    updatedAt: dateOffset(-2),
  },
]

// ============================================================================
// MOCK CONTENT
// ============================================================================

const mockContent: ContentItem[] = [
  {
    id: 'content-1',
    title: 'The 5-minute reset that changed my mornings',
    channelId: 'channel-1',
    pipelineId: 'pipeline-long-form',
    status: 'Published' as ContentStatus,
    createdAt: dateOffset(-28),
    scheduledAt: '',
    format: 'Long-form video',
    publishPreference: 'Publish manually when ready',
    notes: 'A practical morning routine with a calm, encouraging tone.',
    thumbnail: 'thumb-sunrise',
    updatedAt: dateOffset(-28),
  },
  {
    id: 'content-2',
    title: 'A calmer way to plan your week',
    channelId: 'channel-2',
    pipelineId: 'pipeline-shorts',
    status: 'Scheduled' as ContentStatus,
    createdAt: dateOffset(-3),
    scheduledAt: dateOffset(2),
    format: 'YouTube Short',
    publishPreference: 'Schedule for a date',
    notes: 'Keep the pacing gentle and the steps easy to follow.',
    thumbnail: 'thumb-journal',
    updatedAt: dateOffset(-3),
  },
  {
    id: 'content-3',
    title: 'Stop overthinking. Start creating.',
    channelId: 'channel-1',
    pipelineId: 'pipeline-long-form',
    status: 'Ready' as ContentStatus,
    createdAt: dateOffset(-2),
    scheduledAt: '',
    format: 'Long-form video',
    publishPreference: 'Publish manually when ready',
    notes: 'Ready for a final editorial review.',
    thumbnail: 'thumb-creative',
    updatedAt: dateOffset(-2),
  },
  {
    id: 'content-4',
    title: 'Build a life you don\'t need a break from',
    channelId: 'channel-2',
    pipelineId: 'pipeline-long-form',
    status: 'Editing' as ContentStatus,
    createdAt: dateOffset(-4),
    scheduledAt: '',
    format: 'Long-form video',
    publishPreference: 'Decide later',
    notes: '',
    thumbnail: 'thumb-life',
    updatedAt: dateOffset(-4),
  },
  {
    id: 'content-5',
    title: 'Three ways to make space for better ideas',
    channelId: 'channel-1',
    pipelineId: 'pipeline-shorts',
    status: 'Generating' as ContentStatus,
    createdAt: dateOffset(-1),
    scheduledAt: '',
    format: 'YouTube Short',
    publishPreference: 'Decide later',
    notes: 'Concept only; generation status is mock data.',
    thumbnail: 'thumb-creative',
    updatedAt: dateOffset(-1),
  },
  {
    id: 'content-6',
    title: 'A kinder script for difficult days',
    channelId: 'channel-2',
    pipelineId: 'pipeline-long-form',
    status: 'Script' as ContentStatus,
    createdAt: dateOffset(-5),
    scheduledAt: '',
    format: 'Long-form video',
    publishPreference: 'Decide later',
    notes: '',
    thumbnail: 'thumb-journal',
    updatedAt: dateOffset(-5),
  },
  {
    id: 'content-7',
    title: 'Why your next idea can start small',
    channelId: 'channel-1',
    pipelineId: 'pipeline-newsletter',
    status: 'Idea' as ContentStatus,
    createdAt: dateOffset(-6),
    scheduledAt: '',
    format: 'Explainer',
    publishPreference: 'Decide later',
    notes: 'Explore the value of small creative habits.',
    thumbnail: 'thumb-sunrise',
    updatedAt: dateOffset(-6),
  },
  {
    id: 'content-8',
    title: 'The focus timer that did not work',
    channelId: 'channel-2',
    pipelineId: 'pipeline-shorts',
    status: 'Failed' as ContentStatus,
    createdAt: dateOffset(-8),
    scheduledAt: '',
    format: 'YouTube Short',
    publishPreference: 'Decide later',
    notes: 'Mock failure: source clip needs to be reviewed.',
    thumbnail: 'thumb-life',
    updatedAt: dateOffset(-8),
  },
]

// ============================================================================
// MOCK PIPELINES
// ============================================================================

function createPipelineStep(kind: PipelineStepKind, index: number): PipelineStep {
  return {
    id: `step-${index}-${kind.toLowerCase().replaceAll(' ', '-')}`,
    kind,
    enabled: true,
    config: { instructions: '', providerId: null },
    order: index,
  }
}

const defaultPipelineSteps: PipelineStepKind[] = [
  'Idea', 'Script', 'Voice', 'Visuals', 'Edit', 'Captions', 'Thumbnail', 'Quality check', 'Upload', 'Schedule'
]

function createDefaultSteps(): PipelineStep[] {
  return defaultPipelineSteps.map((kind, index) => createPipelineStep(kind, index))
}

function createStepsFromKinds(kinds: PipelineStepKind[]): PipelineStep[] {
  return kinds.map((kind, index) => createPipelineStep(kind, index))
}

const mockPipelines: Pipeline[] = [
  {
    id: 'pipeline-long-form',
    name: 'Long-form video',
    description: 'A complete path from a rough idea to a polished, ready-to-publish video.',
    assignedChannelIds: ['channel-1', 'channel-2'],
    enabled: true,
    lastUsed: 'Today, 10:42 AM',
    steps: createDefaultSteps(),
    createdAt: dateOffset(-90),
    updatedAt: dateOffset(0),
  },
  {
    id: 'pipeline-shorts',
    name: 'Shorts repurpose',
    description: 'Turn a source idea into a concise vertical video with captions and a thumbnail.',
    assignedChannelIds: ['channel-2'],
    enabled: true,
    lastUsed: 'Yesterday',
    steps: createStepsFromKinds(['Idea', 'Script', 'Visuals', 'Edit', 'Captions', 'Quality check', 'Upload', 'Schedule']),
    createdAt: dateOffset(-90),
    updatedAt: dateOffset(-1),
  },
  {
    id: 'pipeline-newsletter',
    name: 'Weekly newsletter',
    description: 'Select the week\'s stories, draft a newsletter, and review it before sending.',
    assignedChannelIds: [],
    enabled: false,
    lastUsed: 'Sep 21, 2026',
    steps: createStepsFromKinds(['Idea', 'Research', 'Script', 'Review']),
    createdAt: dateOffset(-90),
    updatedAt: dateOffset(-6),
  },
]

// ============================================================================
// MOCK SCHEDULED VIDEOS
// ============================================================================

const mockScheduledVideos: ScheduledVideo[] = [
  {
    id: 'schedule-1',
    contentId: 'content-2',
    title: 'A calmer way to plan your week',
    thumbnail: 'thumb-journal',
    channelId: 'channel-2',
    pipelineId: 'pipeline-shorts',
    scheduledAt: dateTimeOffset(1, 11, 0),
    status: 'Scheduled' as ScheduleStatus,
    createdAt: dateOffset(-3),
    updatedAt: dateOffset(-3),
  },
  {
    id: 'schedule-2',
    contentId: 'content-3',
    title: 'The creative reset',
    thumbnail: 'thumb-creative',
    channelId: 'channel-1',
    pipelineId: 'pipeline-long-form',
    scheduledAt: dateTimeOffset(4, 9, 30),
    status: 'Scheduled' as ScheduleStatus,
    createdAt: dateOffset(-2),
    updatedAt: dateOffset(-2),
  },
  {
    id: 'schedule-3',
    contentId: 'content-4',
    title: 'Make room for better ideas',
    thumbnail: 'thumb-life',
    channelId: 'channel-2',
    pipelineId: 'pipeline-shorts',
    scheduledAt: dateTimeOffset(6, 11, 0),
    status: 'Ready' as ScheduleStatus,
    createdAt: dateOffset(-4),
    updatedAt: dateOffset(-4),
  },
  {
    id: 'schedule-4',
    contentId: 'content-5',
    title: 'Small habits, lasting momentum',
    thumbnail: 'thumb-sunrise',
    channelId: 'channel-1',
    pipelineId: 'pipeline-long-form',
    scheduledAt: dateTimeOffset(9, 9, 30),
    status: 'Processing' as ScheduleStatus,
    createdAt: dateOffset(-1),
    updatedAt: dateOffset(-1),
  },
  {
    id: 'schedule-5',
    contentId: 'content-6',
    title: 'A softer start to your Sunday',
    thumbnail: 'thumb-journal',
    channelId: 'channel-2',
    pipelineId: 'pipeline-long-form',
    scheduledAt: dateTimeOffset(12, 11, 0),
    status: 'Needs attention' as ScheduleStatus,
    createdAt: dateOffset(-5),
    updatedAt: dateOffset(-5),
  },
  {
    id: 'schedule-6',
    contentId: 'content-7',
    title: 'Make your next idea easier',
    thumbnail: 'thumb-creative',
    channelId: 'channel-1',
    pipelineId: 'pipeline-shorts',
    scheduledAt: dateTimeOffset(18, 10, 0),
    status: 'Scheduled' as ScheduleStatus,
    createdAt: dateOffset(-6),
    updatedAt: dateOffset(-6),
  },
]

// ============================================================================
// MOCK USER PREFERENCES
// ============================================================================

const mockPreferences: UserPreferences = {
  id: 'preferences-1',
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
  defaultChannelId: 'channel-1',
  defaultVisibility: 'private',
  defaultPublishTime: '09:30',
  defaultPipelineId: 'pipeline-long-form',
  textProviderId: 'provider-openai',
  voiceProviderId: null,
  imageProviderId: null,
  createdAt: dateOffset(-365),
  updatedAt: dateOffset(0),
}

// ============================================================================
// MOCK ANALYTICS
// ============================================================================

const mockAnalytics: AnalyticsVideo[] = [
  {
    id: 'analytics-1',
    contentId: 'content-1',
    title: 'The 5-minute reset that changed my mornings',
    channelId: 'channel-1',
    pipelineId: 'pipeline-long-form',
    contentType: 'Long-form',
    publishedAt: dateOffset(-3),
    thumbnail: 'thumb-sunrise',
    views: 12840,
    watchTimeHours: 804,
    averageDurationSeconds: 322,
    engagementRate: 8.4,
    subscribersGained: 86,
    createdAt: dateOffset(-3),
    updatedAt: dateOffset(-3),
  },
  {
    id: 'analytics-2',
    contentId: 'content-2',
    title: 'A calmer way to plan your week',
    channelId: 'channel-2',
    pipelineId: 'pipeline-shorts',
    contentType: 'Short',
    publishedAt: dateOffset(-8),
    thumbnail: 'thumb-journal',
    views: 9410,
    watchTimeHours: 318,
    averageDurationSeconds: 47,
    engagementRate: 7.1,
    subscribersGained: 62,
    createdAt: dateOffset(-8),
    updatedAt: dateOffset(-8),
  },
  {
    id: 'analytics-3',
    contentId: 'content-3',
    title: 'Stop overthinking. Start creating.',
    channelId: 'channel-1',
    pipelineId: 'pipeline-long-form',
    contentType: 'Long-form',
    publishedAt: dateOffset(-15),
    thumbnail: 'thumb-creative',
    views: 7830,
    watchTimeHours: 492,
    averageDurationSeconds: 284,
    engagementRate: 6.8,
    subscribersGained: 54,
    createdAt: dateOffset(-15),
    updatedAt: dateOffset(-15),
  },
  {
    id: 'analytics-4',
    contentId: 'content-4',
    title: 'Build a life you don\'t need a break from',
    channelId: 'channel-2',
    pipelineId: 'pipeline-long-form',
    contentType: 'Long-form',
    publishedAt: dateOffset(-25),
    thumbnail: 'thumb-life',
    views: 11620,
    watchTimeHours: 726,
    averageDurationSeconds: 263,
    engagementRate: 8.1,
    subscribersGained: 93,
    createdAt: dateOffset(-25),
    updatedAt: dateOffset(-25),
  },
  {
    id: 'analytics-5',
    contentId: 'content-5',
    title: 'Three ways to make space for better ideas',
    channelId: 'channel-1',
    pipelineId: 'pipeline-shorts',
    contentType: 'Short',
    publishedAt: dateOffset(-43),
    thumbnail: 'thumb-creative',
    views: 6840,
    watchTimeHours: 214,
    averageDurationSeconds: 39,
    engagementRate: 6.2,
    subscribersGained: 37,
    createdAt: dateOffset(-43),
    updatedAt: dateOffset(-43),
  },
  {
    id: 'analytics-6',
    contentId: 'content-6',
    title: 'A kinder script for difficult days',
    channelId: 'channel-2',
    pipelineId: 'pipeline-long-form',
    contentType: 'Long-form',
    publishedAt: dateOffset(-68),
    thumbnail: 'thumb-journal',
    views: 10280,
    watchTimeHours: 618,
    averageDurationSeconds: 216,
    engagementRate: 7.4,
    subscribersGained: 75,
    createdAt: dateOffset(-68),
    updatedAt: dateOffset(-68),
  },
  {
    id: 'analytics-7',
    contentId: 'content-7',
    title: 'Make your next idea easier',
    channelId: 'channel-1',
    pipelineId: 'pipeline-shorts',
    contentType: 'Short',
    publishedAt: dateOffset(-5),
    thumbnail: 'thumb-creative',
    views: 5270,
    watchTimeHours: 167,
    averageDurationSeconds: 42,
    engagementRate: 5.9,
    subscribersGained: 29,
    createdAt: dateOffset(-5),
    updatedAt: dateOffset(-5),
  },
  {
    id: 'analytics-8',
    contentId: 'content-8',
    title: 'Small habits, lasting momentum',
    channelId: 'channel-2',
    pipelineId: 'pipeline-long-form',
    contentType: 'Long-form',
    publishedAt: dateOffset(-33),
    thumbnail: 'thumb-sunrise',
    views: 8670,
    watchTimeHours: 514,
    averageDurationSeconds: 213,
    engagementRate: 6.7,
    subscribersGained: 61,
    createdAt: dateOffset(-33),
    updatedAt: dateOffset(-33),
  },
]

// ============================================================================
// MOCK ACTIVITIES
// ============================================================================

const mockActivities: Activity[] = [
  {
    id: 'activity-1',
    category: 'Upload' as ActivityCategory,
    title: 'Video published',
    detail: 'The 5-minute reset that changed my mornings · Creative Growth',
    time: '2 hours ago',
    icon: 'Upload',
    tone: 'activity-green' as ActivityTone,
    relatedContentId: 'content-1',
    createdAt: dateTimeOffset(0, 8, 30),
  },
  {
    id: 'activity-2',
    category: 'Generation' as ActivityCategory,
    title: 'Video generation completed',
    detail: 'A calmer way to plan your week · Mindful Minutes',
    time: '4 hours ago',
    icon: 'Sparkles',
    tone: 'activity-purple' as ActivityTone,
    relatedContentId: 'content-2',
    createdAt: dateTimeOffset(0, 6, 30),
  },
  {
    id: 'activity-3',
    category: 'Scheduling' as ActivityCategory,
    title: 'Upload scheduled',
    detail: 'The creative reset · Creative Growth',
    time: 'Yesterday',
    icon: 'CalendarDays',
    tone: 'activity-blue' as ActivityTone,
    relatedContentId: 'content-3',
    createdAt: dateTimeOffset(-1, 15, 0),
  },
  {
    id: 'activity-4',
    category: 'Warning' as ActivityCategory,
    title: 'Review needed',
    detail: 'Captions could not be added to "Studio tour"',
    time: 'Yesterday',
    icon: 'AlertTriangle',
    tone: 'activity-amber' as ActivityTone,
    relatedContentId: null,
    createdAt: dateTimeOffset(-1, 12, 0),
  },
  {
    id: 'activity-5',
    category: 'Failure' as ActivityCategory,
    title: 'Processing paused',
    detail: 'Thumbnail render timed out · Retry when ready',
    time: 'Sep 24',
    icon: 'CirclePlay',
    tone: 'activity-red' as ActivityTone,
    relatedContentId: null,
    createdAt: dateTimeOffset(-3, 10, 0),
  },
]

// ============================================================================
// INITIAL STATE EXPORT
// ============================================================================

export function getMockInitialState() {
  const scheduleStatus = { Scheduled: 'Scheduled', Ready: 'Ready', Processing: 'Generating', 'Needs attention': 'Failed' } as const
  const schedules = mockScheduledVideos.map(schedule => {
    const item = mockContent.find(content => content.id === schedule.contentId)!
    return { ...schedule, title: item.title, thumbnail: item.thumbnail, channelId: item.channelId, pipelineId: item.pipelineId }
  })
  const content = mockContent.map(item => {
    const schedule = schedules.find(schedule => schedule.contentId === item.id)
    return schedule ? { ...item, scheduledAt: schedule.scheduledAt, status: scheduleStatus[schedule.status], publishPreference: 'Schedule for a date' as const } : item
  })
  return {
    channels: new Map(mockChannels.map(channel => [channel.id, { ...channel,
      scheduleDays: channel.scheduleDays === 'Not set' ? '' : channel.scheduleDays,
      scheduleTime: channel.id === 'channel-1' ? '09:30' : channel.id === 'channel-2' ? '11:00' : '',
    }])),
    providers: new Map(mockProviders.map((provider) => [provider.id, provider])),
    content: new Map(content.map((item) => [item.id, item])),
    pipelines: new Map(mockPipelines.map((pipeline) => [pipeline.id, pipeline])),
    scheduledVideos: new Map(schedules.map((video) => [video.id, video])),
    jobs: new Map(),
    preferences: mockPreferences,
    analytics: new Map(mockAnalytics.map((analytics) => [analytics.id, analytics])),
    activities: mockActivities,
    selectedChannelId: null,
    selectedContentId: null,
    selectedPipelineId: null,
  }
}

// ============================================================================
// HELPER FUNCTIONS FOR UI COMPATIBILITY
// ============================================================================

export function getChannelByName(name: string): Channel | undefined {
  return mockChannels.find((channel) => channel.name === name)
}

export function getPipelineByName(name: string): Pipeline | undefined {
  return mockPipelines.find((pipeline) => pipeline.name === name)
}

export function getProviderById(id: string): AIProvider | undefined {
  return mockProviders.find((provider) => provider.id === id)
}
