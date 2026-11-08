# Database architecture

Prisma 7 / PostgreSQL schema: `prisma/schema.prisma`. Initial migration: `prisma/migrations/20261105000000_initial_database/migration.sql`. No passwords, API keys or OAuth tokens are modeled or seeded.

## Setup

In `server`, run `npm ci`, copy `.env.example` to `.env`, and replace the PostgreSQL placeholders. Provision an empty PostgreSQL 16+ development database separately. Then run:

1. `npm run db:validate`
2. `npm run db:generate`
3. `npm run db:migrate` (deploy committed migrations; no reset)
4. `npm run db:status`

For future schema changes, use `npm run db:migrate:dev -- --name descriptive_name` against development only. Do not bypass migration history with `db push`. Generate before compiling the backend; migration deployment does not generate the client. CLI commands load optional `.env`; production can supply variables externally.

The initial migration was generated offline from an empty schema. Live migration deployment/status and seed execution require a configured PostgreSQL server and have not been verified against one in this environment.

Checks performed: Prisma schema validation, client generation, focused client/seed type checking, and application of the migration SQL to a disposable embedded PostgreSQL engine (PGlite already present through Prisma tooling; no dependency added). Constraint checks covered cross-owner references, restricted deletion, duplicate active jobs, progress limits, terminal timestamps and cascading job events. This does not replace a live PostgreSQL migration deployment check. No full test suite, lint or production build was run.

## Development seed

Set `NODE_ENV=development` and `ALLOW_DEV_SEED=true`, use a localhost `DATABASE_URL`, then run `npm run db:seed`. The script rejects other environments/hosts. Localhost may still be a tunnel; the operator must choose a development database. Disable seed opt-in afterward.

The transactional, repeatable seed adds fixed sample IDs: a user (`demo@example.invalid`, no credentials), disconnected channel, mock provider, pipeline with steps/assignment, idea, preferences and activity. It neither deletes records nor overwrites existing values. Unique conflicts fail atomically. It creates no scheduled work or fake published metrics.

## Models and ownership

`User` owns all entities; `UserPreferences` is one-to-one. `Channel`, `AIProvider`, `Pipeline` and ordered `PipelineStep` adapt existing frontend models; `PipelineChannel` normalizes channel assignments. `ContentItem` owns channel/pipeline/title/thumbnail. `Schedule` is unique per content and derives those fields rather than duplicating them. `Job` stores queue status, progress, timestamps, attempt, idempotency key and JSON execution checkpoint; `JobEvent` stores attempt history. `Activity` links operations to entities. `AnalyticsRecord` stores per-content timestamped snapshots with integer views and precise decimal metrics. Subscriber deltas may be negative.

Composite foreign keys include `userId`, preventing cross-owner relationships even in preferences and assignments. Job steps must belong to the job's pipeline; linked schedules must belong to the job's content. Every service MUST scope queries to the authenticated userId: foreign keys do not filter reads. Phase 3D adds database-backed cookie authentication (see SECURITY.md); row-level security is not implemented. The Prisma client is for trusted backend services only.

UUID IDs, timestamptz timestamps, status enums, foreign-key indexes, unique handles per owner, unique step ordering, analytics snapshot uniqueness and per-user job idempotency are included. Migration-owned SQL adds case-insensitive email/handle uniqueness, valid time strings, metric/order/duration checks, progress/attempt limits, terminal completion timestamps and one QUEUED/PROCESSING job per content. Preserve these custom checks/partial indexes in future migrations; Prisma schema alone does not represent them.

Referenced channels/providers/pipelines, preferences and historical activity/job links use RESTRICT. Reassign or unlink explicitly in a transaction before deleting referenced records. Pipeline steps/assignments cascade with their pipeline; schedules/jobs/analytics cascade with content, subject to retained restrictive history references. Ownership cascades from User, but deleting a user may require dependency cleanup first. Identity updates are blocked by dependent relations. These rules prevent dangling links without silently reassigning records.

`src/database/index.ts` creates an adapter-backed Prisma client per application. Fastify exposes `app.database` and disconnects on shutdown. Connections are lazy and `/health` remains liveness only. Inject this client into future services; use transactions for workflow updates. Never log credentials, connection URLs or unrestricted user metadata.

## Mapping boundaries

Database scheduling uses absolute UTC timestamptz instants plus the IANA timezone label. A future API must resolve browser wall-time values once, with explicit DST handling. Changing preferences will not move database instants. Browser persistence/import is unchanged until application APIs exist. BigInt/Decimal serialization, uppercase enum mapping and browser-ID import require future API adapters. UI counts/initials/relative labels/recent uploads derive from entities rather than stored presentation fields.

JSON checkpoints require versioned application validation before worker/API use. Provider-category validation, IANA timezone validation, content/job state transitions and transactional status synchronization are service responsibilities. Phase 3C adds the resource APIs, and Phase 3D adds authentication; neither phase adds workers, media storage or external integrations.

Authentication migration: `20261105010000_authentication` adds a nullable encoded password hash to legacy User rows and a Session table containing only token hashes, ownership and expiry timestamps. Database checks reject plaintext password formats and malformed token hashes. Legacy seed users have no credentials. No passwords or plaintext session tokens are seeded or persisted. Sessions cascade with their owner and have indexed user/expiry fields.
