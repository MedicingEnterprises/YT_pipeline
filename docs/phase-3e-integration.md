# Phase 3E: frontend/backend integration

The normal frontend entry point now mounts authenticated, API-backed workspace state. It does not fall back to local mock CRUD or write server data to localStorage. Existing React Context consumers, pages, tables, dialogs, filters, styling and form components are reused. The old StoreProvider remains available for explicit isolated previews/tests; it is not mounted by main.tsx.

## Start locally

1. In `server`, configure the ignored `.env` using `.env.example`: PostgreSQL DATABASE_URL, a generated SESSION_SECRET, APP_ORIGINS including the frontend origin, and local/production cookie settings as documented in server/SECURITY.md.
2. Run `npm run db:generate` and `npm run db:migrate` in server. This includes `20261106000000_workspace_integration`, which adds per-user import receipts. Live deployment requires your provisioned PostgreSQL database; the implementation checks used a disposable database.
3. Run the backend with `npm run dev` in server.
4. At the repository root, copy `.env.example` to `.env` and set VITE_API_BASE_URL to the backend **origin**, e.g. `http://localhost:3001`. An empty value supports a same-origin reverse proxy. Never expose database/session secrets in VITE variables.
5. Run the frontend with `npm run dev`, use a consistent hostname (localhost on both frontend and backend, or 127.0.0.1 on both), and register/sign in. Production requires HTTPS and same-site cookie deployment with an explicit CORS allowlist.

## Connected functionality

- Central client: credentialed fetch, CSRF proof acquisition/coalescing/rotation, bounded request lifetime, safe API errors/field paths, network errors and unauthorized notifications. Failed writes are never automatically replayed.
- Authentication: registration, login, logout and profile/session restoration. HttpOnly session cookies remain browser-managed; no credentials/tokens are written to localStorage. Switching/expiring accounts clears the previous workspace and unmounts drafts.
- Channels and mock AI providers: create/edit/delete/connect toggles and configuration save through existing resource APIs.
- Content: create/edit/lifecycle changes use APIs, and successful server IDs drive details/navigation. Scheduled content uses the Scheduler flow rather than sending an unsupported raw stage update.
- Pipelines/steps/assignments: creates use the existing API; editing uses an atomic configuration endpoint preserving existing step IDs, generating new IDs and safely reordering steps. Active/historical relationship constraints return safe server errors.
- Schedules: creation, changes and deletion use APIs and synchronize queued jobs/content in a transaction. UTC instants round-trip to the workspace timezone for forms/calendar display. DST folds/gaps are rejected explicitly rather than guessed.
- Jobs: queue, pause/resume/cancel/retry, shared status, persisted history and polling use backend records. Activity and analytics are read from the same owner-scoped snapshot. Analytics remains mock/manual data; chart projections use JavaScript numbers while server counters retain exact decimal/BigInt strings.
- Dashboard/channel/pipeline/content/scheduler counters and details derive from the same snapshot. Settings/preferences save to the server; reset is a confirmed, owner-scoped server transaction.

Snapshot GET `/api/v1/workspace` uses one RepeatableRead transaction and includes owned channels/providers/pipelines/steps/assignments/content/schedules/jobs/events/activity/analytics/preferences. The client refreshes after mutations and every five seconds while the document is visible. This is not a live subscription. It aborts stale loads and blocks writes when a previous mutation's outcome is uncertain until a successful refresh. Snapshots are limited to 10000 records per collection, and job history included in a snapshot is capped at 1000 events; larger workspaces need paginated loading. No production-scale claim is made.

## Explicit local workspace import

The app detects `content-hub.workspace` without overwriting it. A collapsed import panel offers original-backup download or JSON-file selection. Versioned local formats 1–4 are deserialized with the existing Map-aware persistence reader, then converted to an allowlisted import format. Date-only legacy timestamps become midnight UTC, blank preferred channel times use the server's 09:00 default, and 12-hour preferred times are normalized. Ambiguous local scheduling times require correction rather than silent conversion.

Preview shows record counts and checks whether that account already imported the same normalized source. Confirmation names the signed-in account and explains recovery adjustments. Preferences are kept by default; replacing them requires a separate checkbox. Source IDs are mapped to new server UUIDs. References are validated against records in the same import, never other users or arbitrary server IDs. Existing records are not overwritten. Conflicting names/handles, bad configurations, missing references, invalid metrics or invalid source data reject the whole transaction.

The digest is canonical across collection ordering, scoped to the owner, and committed with all imported records. Double submissions, retry after a lost response and refresh cannot replay the same source. Receipts survive workspace reset. A different backup conflicting with existing records also fails instead of overwriting them. The import body is capped at 5 MB / 1000 records per collection and the normal bounded transaction timeout still applies.

Historical terminal jobs retain their timestamps, attempts and queue events; active browser jobs become CANCELLED with an additional import/cancellation event. The original execution/checkpoint JSON stays in the untouched backup and is not resumed on the server. Future armed schedules create one queued backend job; overdue/non-armed schedules are held as Needs attention with Failed content for review. Imported dates/statuses are historical snapshots, not proof of a real upload. Activity is preserved where timestamps exist; old entries without dates use import time. Presentation-only seed fields (relative labels, initials, recent-upload summaries and formatted channel subscriber/video counters) are not treated as authoritative measurements; server presentation derives from imported entities and analytics. Their original values remain in the backup.

Invalid/unavailable browser storage does not prevent signing in or using the server. A selected backup can be corrected and retried; original browser data/files are never removed. Failed import transactions leave no partial rows/receipt. If import commits but refreshing fails, the UI reports that distinction; re-preview detects the successful receipt. No local success marker is required for safety.

Server integration endpoints are documented at `/openapi.json`: workspace snapshot, import preview/commit, confirmed reset, and atomic pipeline configuration. They use the same session, CSRF, ownership and validation boundaries as existing APIs.

## Remaining boundaries

There is no backend pipeline/scheduling execution worker in the current API. The frontend queues and controls persisted jobs but deliberately does not run the old local timer against server-backed entities. Automatic step progression, failure simulation and due-job publication are therefore disconnected until an API-backed mock executor is provided. The interface says this explicitly. Content can still follow permitted manual lifecycle transitions; no real media/publishing is performed.

Profile/password-change forms and MFA setup remain disconnected in Settings, although the profile/password backend APIs exist. Real AI, video processing, YouTube OAuth/uploads, external analytics collection and production background execution are outside this phase. No frontend redesign or runtime dependency was added.

## Focused verification

`npm run test:integration` and `npm run test:client` from server exercise the frontend transport/adapters against real Fastify/Prisma with disposable PostgreSQL SQL, plus transport error/CSRF behavior. Both frontend and backend TypeScript checks are used. The complete application suite, lint and production build are intentionally not run. Live PostgreSQL deployment and full browser-level interaction remain separate environment checks. The root's pre-existing package-lock.json modification is preserved.

The optional `npm run test:browser:smoke` starts disposable backend/Vite services and an isolated Chrome profile. Set CHROME_PATH if Chrome/Edge is not installed at the default Windows Chrome location. It passed registration, double-submit prevention, channel creation, refresh/session restoration and logout with no uncaught page exceptions. This is a narrow smoke check, not the full browser suite or visual/accessibility acceptance test.

Result: the targeted client/backend workflow passed 42 HTTP requests, the transport error/CSRF checks passed, the Chrome smoke check passed, and frontend/backend TypeScript plus Prisma validation passed. No live database was modified. The existing root lockfile diff remained unchanged.
