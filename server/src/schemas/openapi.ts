import { resources, bodySchema, listSchema, preferencesSchema, jobActionSchema, reorderSchema, pipelineConfigurationSchema, type Resource } from './resources.js'
import { textRequestSchema, usageQuerySchema } from './ai.schema.js'
import { importSchema } from './import.schema.js'
import { loginSchema, registerSchema, profileSchema, passwordSchema } from './auth.schema.js'
type ObjectValue = Record<string, unknown>
const error = { description: 'Error response', content: { 'application/json': { schema: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'requestId'], properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } } } } } } } }
const response = (collection = false) => ({ description: 'Successful response. BigInt and Decimal values are JSON strings; timestamps are ISO UTC instants.', content: { 'application/json': { schema: { type: 'object', required: collection ? ['data', 'pagination'] : ['data'], properties: { data: collection ? { type: 'array', items: { type: 'object', additionalProperties: true } } : { type: 'object', additionalProperties: true }, ...(collection ? { pagination: { type: 'object', required: ['page', 'limit', 'total', 'totalPages'], properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } } } : {}) } } } } })
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 502, 503, 504].map(status => [status, error]))
const requestBody = (schema: unknown) => ({ required: true, content: { 'application/json': { schema } } })
const id = { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }
export function openApiDocument(): ObjectValue {
  const paths: Record<string, ObjectValue> = {}
  const operation = (summary: string, success: number, extra: ObjectValue = {}, collection = false): ObjectValue => ({ summary, security: [{ CookieSession: [] }], responses: { ...errors, [success]: success === 204 ? { description: 'Success; no response body' } : response(collection) }, ...extra })
  for (const resource of Object.keys(resources) as Resource[]) {
    const base = `/api/v1/${resource}`
    const query = listSchema(resource).properties as Record<string, ObjectValue>
    paths[base] = { get: operation(`List ${resource}`, 200, { parameters: Object.entries(query).map(([name, schema]) => ({ in: 'query', name, schema })) }, true) }
    paths[`${base}/{id}`] = { parameters: [id], get: operation(`Read ${resource}`, 200) }
    if (resource === 'activity') continue
    paths[base]!.post = operation(`Create ${resource}`, 201, { requestBody: requestBody(bodySchema(resource, false)) })
    paths[`${base}/{id}`]!.patch = operation(resource === 'jobs' ? 'Control a job' : `Update ${resource}`, 200, { requestBody: requestBody(resource === 'jobs' ? jobActionSchema : bodySchema(resource, true)) })
    paths[`${base}/{id}`]!.delete = operation(`Delete ${resource}`, 204)
  }
  paths['/api/v1/ai/text'] = { post: operation('Generate text once using an owned configured provider/model. Unique requestId required; duplicate IDs return 409 without another provider call. Costs are unknown/null.', 200, { requestBody: requestBody(textRequestSchema) }) }
  paths['/api/v1/ai/usage'] = { get: operation('List owned AI usage metadata; no prompts or generated text', 200, { parameters: Object.entries(usageQuerySchema.properties as ObjectValue).map(([name, schema]) => ({ in: 'query', name, schema })) }, true) }
  paths['/api/v1/ai-provider-catalog'] = { get: operation('Read the maintained provider/model catalog; not a guarantee of account access', 200) }
  paths['/api/v1/ai-providers/{id}/test-connection'] = { parameters: [id], post: operation('Verify stored credentials against the provider; no generation. Requires an enabled real adapter and saved key.', 200) }
  paths['/api/v1/preferences'] = { get: operation('Read preferences', 200), patch: operation('Update preferences', 200, { requestBody: requestBody({ ...preferencesSchema, minProperties: 1 }) }) }
  paths['/api/v1/jobs/{id}/history'] = { parameters: [id], get: operation('Read job history', 200, { parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }] }, true) }
  paths['/api/v1/pipelines/{id}/steps/order'] = { parameters: [id], put: operation('Reorder all steps atomically', 200, { requestBody: requestBody(reorderSchema), responses: { ...errors, 200: { description: 'Ordered step records', content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data: { type: 'array', items: { type: 'object' } } } } } } } } }) }
  paths['/api/v1/auth/csrf'] = { get: operation('Get CSRF proof; initializes anonymous protection cookie when signed out', 200, { security: [] }) }
  paths['/api/v1/auth/register'] = { post: operation('Register and create a session cookie', 201, { requestBody: requestBody(registerSchema), security: [{ AnonymousCsrfCookie: [], CsrfHeader: [] }, { CookieSession: [], CsrfHeader: [] }] }) }
  paths['/api/v1/auth/login'] = { post: operation('Authenticate and rotate the session cookie', 200, { requestBody: requestBody(loginSchema), security: [{ AnonymousCsrfCookie: [], CsrfHeader: [] }, { CookieSession: [], CsrfHeader: [] }] }) }
  paths['/api/v1/auth/logout'] = { post: operation('Revoke current session', 204) }
  paths['/api/v1/auth/logout-all'] = { post: operation('Revoke every session for the authenticated user', 204) }
  paths['/api/v1/auth/me'] = { get: operation('Read public profile', 200), patch: operation('Update profile; changing email requires currentPassword and revokes all sessions', 200, { requestBody: requestBody(profileSchema) }) }
  paths['/api/v1/auth/password'] = { put: operation('Change password and revoke all sessions', 204, { requestBody: requestBody(passwordSchema) }) }
  paths['/api/v1/workspace'] = { get: operation('Read a coherent owner-scoped workspace snapshot', 200) }
  paths['/api/v1/workspace/reset'] = { post: operation('Reset owned workspace data while retaining account, sessions and import receipts', 200, { requestBody: requestBody({ type: 'object', additionalProperties: false, required: ['confirmation'], properties: { confirmation: { type: 'string', const: 'RESET' } } }) }) }
  paths['/api/v1/workspace/import/preview'] = { post: operation('Review import counts and detect an existing import receipt', 200, { requestBody: requestBody(importSchema) }) }
  paths['/api/v1/workspace/import'] = { post: operation('Atomically import a validated workspace using new server IDs', 200, { requestBody: requestBody(importSchema) }) }
  paths['/api/v1/pipelines/{id}/configuration'] = { parameters: [id], put: operation('Atomically save pipeline, steps and assignments', 200, { requestBody: requestBody(pipelineConfigurationSchema) }) }
  for (const path of Object.values(paths)) {
    for (const method of ['post', 'patch', 'put', 'delete']) {
      const entry = path[method] as ObjectValue | undefined
      if (entry && JSON.stringify(entry.security) === JSON.stringify([{ CookieSession: [] }])) entry.security = [{ CookieSession: [], CsrfHeader: [] }]
    }
  }
  return {
    openapi: '3.1.0', info: { title: 'Content Hub API', version: '1.0.0', description: 'Database-backed HTTP-only cookie sessions. GET /api/v1/auth/csrf first and send its csrfToken as X-CSRF-Token on every write, including login/registration. Use credentials: include in browsers. Production cookie names use __Host-; local HTTP development omits that prefix. Session tokens/password hashes are never returned in JSON. See server/SECURITY.md for authentication/configuration and server/API.md for resource response fields.' },
    paths, components: { securitySchemes: {
      CookieSession: { type: 'apiKey', in: 'cookie', name: '__Host-content-hub-session', description: 'Secure HttpOnly SameSite=Lax host-only cookie; development name: content-hub-session' },
      AnonymousCsrfCookie: { type: 'apiKey', in: 'cookie', name: '__Host-content-hub-csrf', description: 'Ten-minute signed HttpOnly protection cookie issued by the CSRF endpoint; development name: content-hub-csrf' },
      CsrfHeader: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: 'Proof returned by GET /api/v1/auth/csrf. Refresh after login or session rotation. This is not a session credential.' },
    } },
  }
}
