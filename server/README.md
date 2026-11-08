# Backend

Phase 3B adds the relational schema, initial migration, reusable Prisma client and development-only seed. See [DATABASE.md](DATABASE.md) for setup, ownership/deletion rules and frontend mapping boundaries.

Phase 3C adds `/api/v1` application endpoints. Phase 3D protects them with database-backed cookie sessions. See [API.md](API.md), [SECURITY.md](SECURITY.md) and `/openapi.json` for contracts and the CSRF/authentication flow. DEV_USER_ID is no longer accepted.

Phase 3E connects the frontend and adds workspace snapshot/import/reset and atomic pipeline configuration endpoints. See [the integration guide](../docs/phase-3e-integration.md). Run `npm run test:integration` and `npm run test:client` for focused integration checks.

Run `npm run test:api` for focused, disposable-database API acceptance checks. This does not run the frontend or complete application test suite.

Independent Node.js 24 LTS / TypeScript ESM application using Fastify 5, PostgreSQL and Prisma 7. Frontend commands and local workspace persistence remain independent.

## Local setup

Run these commands from `server` (PowerShell users can use `npm.cmd`):

1. `npm install`
2. Copy `.env.example` to `.env`, replace the PostgreSQL placeholders and set a generated SESSION_SECRET as described in SECURITY.md. Actual environment files are ignored by Git.
3. `npm run db:generate`, then `npm run db:migrate` against your provisioned local database.
4. `npm run dev`
5. Open `http://127.0.0.1:3001/health`. Register via the auth API to access protected routes.

`NODE_ENV` defaults to development; `HOST` to loopback, `PORT` to 3001 and `LOG_LEVEL` to info. `DATABASE_URL` is required and validated. Client connections are lazy; health does not query the database. Provision PostgreSQL 16+ separately. Production may inject variables directly without an `.env` file.

## Commands

- `npm run dev`: TypeScript watch mode with optional local `.env` loading.
- `npm run typecheck`: backend-only type check.
- `npm run test:auth`: focused authentication/security acceptance checks using a disposable database.
- `npm run build`: compile to `dist`.
- `npm start`: run compiled server (build first; install dev dependencies in the build stage).
- `npm run db:validate`: validate the Prisma configuration/schema.
- `npm run db:generate`: generate Prisma Client before compiling.
- `npm run db:migrate`: deploy committed migrations.
- `npm run db:migrate:dev -- --name example`: create future development migrations.
- `npm run db:status`: inspect migration status.
- `npm run db:seed`: development-only sample data (explicit opt-in required).

Fastify and the Prisma packages are pinned to verified stable releases; other dependency ranges stay within stable major versions. Install dependencies in this directory; do not run installation at the repository root. Keep `prisma`, `@prisma/client` and `@prisma/adapter-pg` on matching releases when upgrading.

On npm versions with install-script approval, review `npm install-scripts ls` if required tooling cannot initialize. Prisma validation and client generation work in this environment.

## Structure and boundaries

`src/server.ts` owns startup/shutdown; `src/app.ts` constructs the app independently of listening. `routes` maps paths to `controllers`; `services` owns behavior; `schemas` provides JSON validation; `middleware` centralizes errors; `config` validates environment settings; `database` constructs the adapter-backed Prisma client. Prisma configuration declares the schema, migrations and seed command.

`GET /health` is a liveness endpoint returning status, service and an ISO UTC timestamp. It does **not** assert database readiness. Unknown routes and errors return a consistent JSON error envelope with a server-generated request ID. Internal errors are logged and hidden from responses. Fastify emits structured JSON request/server logs with sensitive headers redacted. Avoid adding secrets or request bodies to log fields.

Fastify exposes the client as `app.database` and disconnects it on shutdown. Application APIs and authentication/session security are implemented; frontend connection, workers and real external integrations remain outside this subphase. Frontend persistence remains unchanged until API integration.

Full tests, linting and production builds have intentionally not been run in this subphase.
