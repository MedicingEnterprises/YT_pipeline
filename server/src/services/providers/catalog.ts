import type { ProviderCategory } from '@prisma/client'
import { HttpError } from '../../middleware/errors.js'

export interface CatalogModel { id: string; name: string; category: ProviderCategory }
export interface CatalogProvider { id: string; name: string; source: string; models: CatalogModel[] }
/** Deliberately small maintained subset, not a claim of account-specific access.
 * Official sources and review date are exposed alongside IDs; never infer IDs
 * from display names. Update here when providers retire or replace models. */
export const providerCatalog: readonly CatalogProvider[] = [
  { id: 'openai', name: 'OpenAI', source: 'https://developers.openai.com/api/docs/models', models: [
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', category: 'TEXT_GENERATION' },
    { id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS', category: 'TEXT_TO_SPEECH' },
    { id: 'gpt-image-1', name: 'GPT Image 1', category: 'IMAGE_GENERATION' },
    { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', category: 'EMBEDDINGS_ANALYSIS' },
  ] },
  { id: 'anthropic', name: 'Anthropic', source: 'https://platform.claude.com/docs/en/models/overview', models: [
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', category: 'TEXT_GENERATION' },
  ] },
  { id: 'elevenlabs', name: 'ElevenLabs', source: 'https://elevenlabs.io/docs/overview/models', models: [
    { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2', category: 'TEXT_TO_SPEECH' },
    { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5', category: 'TEXT_TO_SPEECH' },
  ] },
  { id: 'stability', name: 'Stability AI', source: 'https://docs.stability.ai/api-reference/sdxl-10/text-to-image', models: [
    { id: 'stable-diffusion-xl-1024-v1-0', name: 'Stable Diffusion XL 1.0', category: 'IMAGE_GENERATION' },
  ] },
  { id: 'runway', name: 'Runway', source: 'https://docs.dev.runwayml.com/guides/models/', models: [
    { id: 'gen4_turbo', name: 'Gen-4 Turbo', category: 'VIDEO_GENERATION' },
    { id: 'gen4.5', name: 'Gen-4.5', category: 'VIDEO_GENERATION' },
  ] },
]
export function validateModelSelection(adapterId: string, category: string, models: readonly string[]): void {
  if (adapterId === 'mock') return // Existing preview configurations retain their semantics.
  const provider = providerCatalog.find(item => item.id === adapterId)
  if (!provider || !models.length || models.some(id => !provider.models.some(model => model.id === id && model.category === category))) {
    throw new HttpError(422, 'MODEL_UNAVAILABLE', 'Choose a supported model for this API service and provider type')
  }
}
