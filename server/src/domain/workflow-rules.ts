// Pure rules shared by frontend validation and backend services. No runtime dependencies.
export type WorkflowStatus = 'Idea' | 'Script' | 'Generating' | 'Editing' | 'Ready' | 'Scheduled' | 'Published' | 'Failed'
export const validChannelHandle = (value: string): boolean => /^@[\p{L}\p{N}_.-]{3,30}$/u.test(value)
export const contentTransitions: Record<WorkflowStatus, WorkflowStatus[]> = {
  Idea: ['Script'], Script: ['Idea', 'Generating', 'Failed'], Generating: ['Editing', 'Failed'],
  Editing: ['Generating', 'Ready', 'Failed'], Ready: ['Editing', 'Scheduled', 'Published', 'Failed'],
  Scheduled: ['Ready', 'Published', 'Failed'], Published: [], Failed: ['Idea', 'Script', 'Generating', 'Editing', 'Ready'],
}
export function supportedProviderCategories(kind: string): string[] {
  if (kind === 'Voice') return ['Text-to-speech']
  if (kind === 'Visuals') return ['Image generation', 'Video generation']
  if (kind === 'Thumbnail') return ['Image generation']
  if (kind === 'Edit') return ['Video generation']
  if (['Research', 'Review', 'Quality check'].includes(kind)) return ['Text generation', 'Embeddings / analysis']
  if (['Idea', 'Script', 'Captions'].includes(kind)) return ['Text generation']
  return []
}
