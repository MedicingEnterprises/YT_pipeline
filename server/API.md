# Content Hub REST API v1

Base path: `/api/v1`. Machine-readable OpenAPI 3.1: `GET /openapi.json` (public, generated from the same request schemas as the routes). `GET /health` remains public liveness only. No frontend/UI connection, real provider calls, uploads or worker is added.

## Identity and ownership

Application routes require a database-backed HTTP-only cookie session. See [SECURITY.md](SECURITY.md) for registration/login/logout/profile/password endpoints, CSRF handshake and environment configuration. `GET /api/v1/auth/csrf` must precede registration/login, and every write requires `X-CSRF-Token`. Browser fetches use `credentials: 'include'`. No bearer-token or OAuth login is implemented.

The former DEV_USER_ID/injected identity shortcut has been removed. Register a real local account; legacy seed users have no password and cannot log in. Arbitrary X-User-Id headers are ignored, and body/query userId fields are rejected. Profile updates cannot set userId, passwordHash or privileges.

Every database query includes the resolved userId. Related entity lookups are also owner-scoped. Missing and other-owner records both return 404. Writes serialize on the owner row inside a Serializable transaction, retrying serialization conflicts twice. List/count snapshots use RepeatableRead. Composite foreign keys remain the final ownership/integrity boundary; no resource can be transferred to another owner through this API.

## Endpoints

| Path | Operations | Notes |
| --- | --- | --- |
| `/channels` and `/channels/{id}` | GET list, POST; GET item, PATCH, DELETE | Mock connection status/configuration |
| `/ai-providers` and `/ai-providers/{id}` | GET list, POST; GET item, PATCH, DELETE | Mock configuration only; no credential fields |
| `/content` and `/content/{id}` | GET list, POST; GET item, PATCH, DELETE | New content starts as IDEA |
| `/pipelines` and `/pipelines/{id}` | GET list, POST; GET item, PATCH, DELETE | Create with configured steps; returns ordered steps and assignedChannelIds |
| `/pipeline-steps` and `/pipeline-steps/{id}` | GET list, POST; GET item, PATCH, DELETE | Filter by pipelineId; append new steps; cannot move to another pipeline |
| `/pipelines/{id}/steps/order` | PUT | `{ "stepIds": ["uuid", "uuid"] }`; every step exactly once |
| `/schedules` and `/schedules/{id}` | GET list, POST; GET item, PATCH, DELETE | Creates/updates a queued job and content status atomically |
| `/jobs` and `/jobs/{id}` | GET list, POST; GET item, PATCH, DELETE | POST queues pipeline work; PATCH accepts a control action only |
| `/jobs/{id}/history` | GET | Paginated attempt/status history, oldest first |
| `/activity` and `/activity/{id}` | GET list, GET item | Read-only; created by services |
| `/analytics` and `/analytics/{id}` | GET list, POST; GET item, PATCH, DELETE | Manual mock snapshots for Published content |
| `/preferences` | GET, PATCH | One per user; registration creates defaults |

## Request contract

All bodies use `application/json`. POST required fields are listed below. PATCH is partial and nonempty. Unknown keys (including id, userId, timestamps, nested Prisma operators, API keys and tokens) are rejected. UUIDs are server-generated. Enums use schema uppercase names, not frontend display labels. Detailed enum values, field bounds and required properties are in `/openapi.json`.

| Resource | Required on POST | Other writable fields |
| --- | --- | --- |
| channels | name, handle | category, color, status, scheduleDays, scheduleTime, defaultPipelineId (nullable) |
| ai-providers | name, category, models | enabled, connected (mock boolean) |
| content | title, channelId, pipelineId | status, format, visibility, publishPreference, notes, thumbnail |
| pipelines | name, steps | description, enabled, assignedChannelIds |
| pipeline-steps | pipelineId, kind, order | enabled, providerId (nullable), instructions, durationMs |
| schedules | contentId, scheduledAt | timezone, executionMode |
| jobs | contentId | idempotencyKey, type (PIPELINE_EXECUTION only), kind (must match first enabled step) |
| analytics | contentId | recordedAt, views, watchTimeHours, averageDurationSeconds, engagementRate, subscribersGained |

Pipeline POST steps accept `kind`, `order` (zero-based contiguous), `enabled`, `providerId`, `instructions`, `durationMs`. Pipelines contain 1–50 steps; an enabled pipeline needs an enabled step. Step dependencies retain the frontend's Script-before-Voice, Edit-before-Captions and Upload-before-Schedule rules. Provider categories must support their assigned steps. Pipeline PATCH does not replace steps: use step CRUD and the atomic reorder endpoint. Individual step PATCH cannot change pipelineId/order; DELETE compacts remaining positions. Active jobs protect workflow dependencies. Referenced historical steps may require keeping the old pipeline configuration rather than deleting it.

Job PATCH: `{ "action": "pause" | "resume" | "cancel" | "retry" }`. Pause/resume require active states and a real change; cancel accepts active/failed jobs; retry accepts failed jobs with valid current dependencies and no other active job. Retry increments attempt, clears errors/completion, preserves checkpoint/progress and records history. Job DELETE requires a terminal state. Raw status, progress, claim, checkpoint or completion timestamp updates are not public write operations. No execution worker/start/complete endpoint is provided: queued database jobs do not automatically run in this subphase. Existing browser-only simulation is separate.

Preferences PATCH accepts workspaceName, timezone, language, appearance, compactDensity, reducedMotion, notifyPipeline, notifyPublishing, notifyWarnings, weeklyDigest, defaultChannelId/defaultPipelineId, textProviderId/voiceProviderId/imageProviderId, defaultVisibility, defaultPublishTime. Nullable references may be cleared; referenced providers must be enabled and support the selected category.

Schedules accept an absolute RFC3339 instant with `Z` or an explicit offset, strictly in the future, and a validated IANA timezone label (defaults to workspace timezone). They require Ready content, a mock-connected channel and an available valid pipeline. Content/pipeline relationships cannot be selected through schedule writes; they derive from content. Updating an unclaimed schedule cancels its old queued jobs and creates a replacement in the same transaction. Claimed schedules reject edits. Cancelling/deleting schedules returns Scheduled content to Ready and preserves detached job history. No due-job dispatcher is implemented on the backend.

Content transitions reuse the frontend rule table. Scheduling goes through `/schedules`; direct status=SCHEDULED is rejected. Publication can be recorded manually only through a valid transition and a mock-connected channel, with no active job; the service sets publishedAt and clears scheduling. Published content cannot revert to earlier stages. Active jobs protect content relationship/stage edits, while title/notes edits remain available. This endpoint records mock state only; it never uploads media.

`views` is a nonnegative decimal **string** bounded by PostgreSQL int64. `watchTimeHours` and `averageDurationSeconds` are nonnegative decimal strings; engagementRate is a number from 0 to 100. Decimal/BigInt response fields are strings to avoid precision loss. Snapshots require Published content. Content IDs cannot change on schedule/analytics PATCH.

## Lists

All lists accept page (default 1), limit (default 25, max 100), sort (allowlisted per resource) and direction (`asc`/`desc`, default desc). Default sort is createdAt except where another field is specified by OpenAPI. Sorting adds id as a stable tie-breaker. Search is case-insensitive over name/handle (channels), name (providers), title/notes (content), name/description (pipelines), instructions (steps), errorMessage (jobs), title/detail (activity). Unsearchable resources reject search.

Filters: channels=status; providers=category/enabled; content=status/channelId/pipelineId/format; pipelines=enabled; steps=pipelineId/kind/enabled; schedules=contentId/status; jobs=contentId/pipelineId/status/type; activity=contentId/channelId/pipelineId/providerId/jobId/category; analytics=contentId. Unknown query parameters or unsupported sort values return 400. History accepts page/limit only.

## Responses

Single entity/create/update: `{ "data": { "id": "uuid", "userId": "uuid", "...": "entity fields" } }`.

List/history: `{ "data": [], "pagination": { "page": 1, "limit": 25, "total": 0, "totalPages": 0 } }`.

Responses contain the database scalar fields documented in `prisma/schema.prisma`, with ISO UTC timestamps, uppercase enums, explicit nulls and decimal/BigInt strings. Pipeline responses additionally contain steps sorted by order and assignedChannelIds. Other relations are accessed through filtered list endpoints, not embedded recursively. Schedule channel/title/pipeline are obtained through its contentId. Job history is a separate endpoint. Client-managed ID/counters/display labels are not accepted.

POST returns 201 and Location. GET/PATCH/PUT return 200. DELETE returns 204 without a body. Application responses use Cache-Control: no-store. Errors always use `{ "error": { "code": "WORKFLOW_CONFLICT", "message": "...", "requestId": "req-1" } }`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid JSON, schema, query or UUID |
| 401 | Missing, invalid, expired or revoked session; incorrect credentials |
| 403 | Invalid/missing CSRF proof or forbidden Origin |
| 404 | Resource/reference absent or owned by another user |
| 409 | Invalid transition, active dependency, uniqueness/FK constraint or exhausted concurrent-write retry |
| 413 / 415 | Body too large / unsupported content type |
| 422 | Semantic validation failure |
| 429 | Authentication rate limit; retry after Retry-After |
| 500 | Unexpected error (internal details hidden) |
| 503 | Database unavailable |

Deleting content requires active work to be cancelled first. Channel/provider/pipeline deletes may return 409 when still referenced: explicitly reassign/unlink dependencies using the API. Services detach historical activity references where safe rather than deleting history. Updates affecting multiple records, schedule/job reconciliation, step reordering and emitted activity/job events are atomic. Authentication/session security and restricted credentialed CORS are implemented. Browser-data import, frontend connection, real integrations and production workers remain outside this subphase.

## Focused verification

Run `npm run test:api` from server for the API-only acceptance check. It uses Fastify injection, the real Prisma client/adapter and a disposable embedded PostgreSQL engine, without reading DATABASE_URL or connecting to an existing database. The pinned PGlite development dependency was already present through Prisma tooling; it is declared directly for reproducible test imports. No runtime dependency was added.

This check covers resource CRUD, filtering/pagination, owner isolation for all resource types, strict inputs, lifecycle rules, pipeline configuration/order, schedule-to-job synchronization, pause/resume/cancel/retry/history, transaction rollback, activity and BigInt analytics serialization. It is a single-connection test bridge, so real PostgreSQL multi-connection locking, deployment and production authentication still require environment-specific verification. The full application test suite and production build were not run.

Phase 3C result: 88 focused HTTP assertions passed, backend `npm run typecheck` passed, and a targeted check confirmed that the frontend still uses the shared lifecycle/provider/handle rules. No frontend styling or components were changed. The root package-lock.json modification was preserved.
