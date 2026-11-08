# Content Hub

Content Hub is a responsive frontend foundation for a creator workspace. It uses shared application state, interactive mock CRUD workflows, and a versioned localStorage workspace snapshot.

## Getting started

```sh
npm install
npm run dev
```

## Pages

- Dashboard
- Channels
- AI Providers
- Pipelines
- Content
- Scheduler
- Analytics
- Settings

The app uses React, TypeScript, Vite, and React Router. Shared layout and UI primitives live in `src/components`; route views live in `src/pages.tsx`, domain models in `src/models`, and shared state, relationship mutations, and seed data in `src/state`.

## Complete mock workflow

1. In Channels, create or choose a channel. Use Mock connect before scheduling publication.
2. In AI Providers, save an enabled mock configuration. In Pipelines, assign it to compatible steps and include the channel in the pipeline's assigned channels (or leave that list empty for any channel).
3. Create an Idea from Content, Dashboard, or the header, selecting its channel and enabled pipeline. Saving opens that item's Content Details.
4. Review the configured steps/providers and choose Run mock pipeline. The default **Finish at Ready for review, then schedule** runs all enabled steps as preparation, including mock Upload/Schedule preparation. No initial publishing date is needed.
5. Expand step details to inspect the provider, instructions, duration, and state. Pause/resume, simulate a failure, retry the failed step, or cancel. Completed checkpoints and controls survive navigation and refresh; restored active runs require explicit resume.
6. A successful preparation run marks content Ready. Review/edit its notes or title, then choose **Schedule ready content** in Details. Content and publishing action are preselected; prepared content defaults to publication-only to avoid running preparation twice. Choose a future time in the saved workspace timezone.
7. Keep the app open. Scheduler shows the queued job, claims it when due, and simulates publication. Content becomes Published; channel totals, Dashboard counts, job history, and activity update from the same workspace state.

Pipeline details show configured steps and associated active/failed/history jobs. Channel details show associated ideas, drafts, scheduled and published content. Job titles, upcoming uploads, channel content, and activity link directly to `/content?content=<id>`. Dashboard can expand its retained activity history. Channel/provider/pipeline CRUD and preferences now contribute actual activity events, subject to existing notification preferences. Missing/deleted content links show an unavailable state instead of an empty modal.

Preparation uses optional built-in mock steps when no provider is assigned. Selecting a configured provider uses its saved profile and validates availability/type; it never makes a connection or API call. Missing/disabled dependencies show recovery links or validation errors. Active definitions/assignments are guarded; disabling a provider can fail its step and can be repaired before retry. Deleting content clears its jobs/schedules and records the deletion.

## Mock pipeline execution

Open **Content → Details** to run the assigned pipeline. Choose a step duration (default 1500 ms) and an optional failing step. The default review mode finishes at Ready. The existing **Follow configured publishing steps** option remains available; it requires a future time when the pipeline includes Schedule. Controls support pause, resume, cancellation, immediate simulated failure, and retry of the failed step. Pipeline cards and details show actual run status and progress.

`src/execution/engine.ts` is a pure command service with injected IDs and time; `src/execution/runner.ts` adapts it to browser timers through a small host interface. No execution logic lives in React views. A future backend worker can replace the driver. Runs snapshot enabled steps, their configured order, instructions, provider assignments, and durations. All configured step kinds are supported, including Research and Review; disabled steps are skipped. The service also accepts per-kind duration overrides. No random failures or external calls are used.

Each run uses one existing Job record with a typed `execution` checkpoint: pipeline ID, QUEUED/PROCESSING/COMPLETED/FAILED/CANCELLED state, pause flag, current/completed/failed steps, percentage progress, timing, last valid content stage, simulation options, and activity sequence. Job status stays compatible with existing pending/running/completed/failed/cancelled values. Progress advances at completed step boundaries. Preparation stages advance monotonically through the existing lifecycle as configured steps run; omitted stages require no fabricated jobs. Creative-only manual pipelines finish at their last preparation stage. Manual pipelines containing Upload mark content mock-published on successful completion; those containing Schedule create a publication-only schedule for the active-app queue. No real upload or publication occurs.

At most one unfinished execution (including paused or failed runs) is allowed per content item. Retry keeps completed steps and re-runs only the failed step and the remainder; an injected failure is cleared for retry. Completed/cancelled history is retained, and a fresh run requires the explicit Start new mock run action. Published or already scheduled content cannot start a new execution. Pipeline definitions and publishing assignments are guarded while a run is open; titles/notes can still be edited, and deleting content cascades to its jobs. Provider availability is checked at step boundaries; disabling a provider may fail its step, after which it can be repaired and retried. Cancelling restores the last valid preparation stage.

Execution checkpoints are persisted through the workspace snapshot. Restored queued/processing pipeline runs open paused and must be resumed explicitly. Completed steps never replay; an unfinished step resumes using its last persisted remaining duration (a running step normally checkpoints its duration at the beginning, while explicit pause saves the remainder). Browser downtime never counts as execution. A manual run's Schedule time that expires before its step completes fails safely; cancel and start a new run with a future time. Automatic progression stops if storage cannot save a checkpoint. There is no durable background worker or real media output.

## Mock queue and active-app scheduling

Scheduler saves admit one durable job per schedule identity (schedule, creation time, content, channel, pipeline, wall time, and action). Only schedules with status Scheduled are armed; Ready, Processing, and Needs attention remain review states. Unprepared content defaults to **Run pipeline, then mock-publish**. Content with completed preparation defaults to **Mock-publish prepared content only**, including scheduling through Content's publishing preference. Schedules produced by completed pipelines also use this action, including older engine-created schedules. Consumed schedules leave the calendar and remain visible in job history.

The centralized `src/execution/queue.ts` service uses existing Job records with typed queue metadata: PIPELINE_EXECUTION, SCHEDULED_PUBLICATION, or RETRY; a persisted claim; attempt count; and transition history including failure details. The existing lowercase job states are displayed as QUEUED, PROCESSING, COMPLETED, FAILED, and CANCELLED. `dispatcher.ts` saves automatic state changes before committing them to the visible workspace. Pipeline steps, queue history, content state, and activity remain synchronized. Multiple due items dispatch independently; a claimed schedule is never recreated by a later poll. Rescheduling cancels the old unclaimed entry; cancellation unschedules pending content. Failed work requires explicit retry, which preserves completed pipeline steps and increments its attempt count. A retry cannot overwrite a newer schedule.

The lightweight browser timer checks about once per second while the app is open. At the due time it validates the content, channel, pipeline, and competing executions. Pipeline mode consumes the schedule and runs the actual configured enabled steps, ending in mock-published content; a configured Schedule step records mock publishing work rather than creating a recursive schedule. Publication-only mode uses a one-second mock publication task without regenerating content. The planned time is a dispatch time, not a guarantee of exact publication: pipeline durations and browser timer throttling can delay completion. There are no API calls, workers, cron jobs, or external queues.

Dashboard shows real mock-job counts and links to the queue. Scheduler shows queue controls and retained history. Content Details shows the associated jobs and pipeline controls. Jobs support cancellation, failure reporting, and retry. Deleting content retains the existing cascade deletion behavior, including its history.

On reopening, overdue persisted unclaimed jobs may dispatch once the app is active again. Interrupted pipeline executions remain paused for explicit resume. An interrupted publication-only task requeues the same claimed job; already completed/cancelled jobs are never dispatched again. Nothing executes while the browser is closed. Automatic work stops on storage failures or stale snapshots. Native Web Locks serialize queue ticks across tabs where available; otherwise the saved-snapshot conflict guard is used. This is not a distributed queue or live cross-tab synchronization.

All planned times are minute-precision wall-clock strings in the **current saved workspace timezone**, shared by validation, due detection, calendar, and date labels (`src/state/time.ts`). The PC timezone is not used to interpret planned values. Changing workspace timezone reinterprets existing unclaimed wall-clock slots in that zone. Job timestamps and durations use UTC instants. Nonexistent spring-forward slots become due at the first observed wall minute after the gap; a repeated fall-back slot is claimed only once. Calendar arithmetic uses UTC carrier dates solely to preserve the entered calendar components, not to reinterpret them as UTC publication instants.

## Preview scope

There is no backend, database, authentication, OAuth, YouTube API, real AI, video generation, or upload service. Workspace changes survive refresh in the same browser and origin when localStorage is available. Provider credential fields are disabled; simulated connection tests never contact a provider.

- Channels: create, edit settings, mock connect/disconnect, and delete empty channels. Reassign or delete a channel's content before deleting it.
- Providers: add, configure, enable/disable, validate mock configuration, and delete. Deletion clears pipeline assignments and preference defaults.
- Content: create from the header, dashboard, or library; edit title, notes, format, visibility, channel, pipeline, status, and planned date; delete with dependent schedules.
- Pipelines: create, edit, delete, assign channels, add/remove/reorder/configure steps, and enable/disable flows or steps.
- Scheduler: create a schedule for content, change the associated item/status/time, reschedule, and delete. One mock schedule per content item. New schedules require Ready content; mock-connected channels and valid enabled pipelines are required for scheduling and publishing. Schedule status maps to content status: Scheduled → Scheduled, Ready → Ready, Processing → Generating, Needs attention → Failed. Publishing a mock content item removes its pending schedule.
- Settings: save shared preferences; workspace name, appearance, density, reduced motion, notification choices, and new-content/provider defaults are applied to the browser workspace. Account/security controls remain unavailable. Reset workspace requires confirmation and creates an empty workspace with default preferences.
- Dashboard, channel summaries, selectors, sidebar counts, and analytics labels use shared state. Analytics measurements remain illustrative fixtures.

Deleting a pipeline retains its content and clears pipeline links, unless an active execution guards it. Deleting content removes its schedules, jobs, analytics rows, and related activity. Dates in mock schedules represent wall-clock times in the saved workspace timezone; no server scheduling service runs.

## Persistence and restoration

`src/state/persistence.ts` owns schema version 4 at localStorage key `content-hub.workspace`. Versions 1–3 migrate without losing existing entities or changing legacy execution behavior. Version 4 preserves the optional review-before-publishing checkpoint and entity-linked activity. The envelope contains `version` and `workspace`. Entity Maps are stored as arrays of records and restored as Maps keyed by validated unique IDs. All seven entity collections, preferences, activity, and nested pipeline steps are saved. Selections, dialogs, drafts, loading state, notices, and reset confirmations are excluded. Provider fields are explicitly allowlisted; no credential configuration is supported. Credential-like keys in job metadata are excluded as well.

On first run (the key is absent), the app starts with demo data and saves it after mount. A valid saved workspace always takes precedence over seeds. Successful domain changes are saved synchronously; storage errors never roll back in-memory CRUD or masquerade as durable saves. A persistent warning offers retry for quota/access failures. Historical dates and disabled dependencies are restored without replaying creation-time validation.

Malformed snapshots, missing required fields, duplicate IDs, broken references, invalid execution/queue checkpoints, and unsupported versions are preserved unchanged. The app opens a demo fallback with a warning and blocks automatic writes until an explicit reset. Versions 1–4 are supported; other versions require a future migration. If another tab changes the saved snapshot, further writes and automatic work in the stale tab are blocked until reload or explicit reset; there is no live cross-tab synchronization.

Settings → Reset workspace opens a confirmation dialog. Confirming atomically replaces the saved snapshot with empty collections and default preferences, then closes existing editors. If the write fails, the current workspace stays intact. Reset does not reseed demo entities. Reset unsaved changes restores the Settings draft from the saved workspace preferences.

Storage is local to the browser profile and origin (including port). Clearing site data, private-session cleanup, or changing browser/origin can remove or hide it. There is no backup, account sync, encryption, or backend. Explicit `StoreProvider initialState` previews/tests stay in memory unless a persistence session is supplied.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:browser
```

`npm test` checks relationship mutations, validation, content transitions, atomic failures, store actions, confirmations, persistence, execution and queue recovery. `tests/workflow.test.mjs` exercises the complete empty-workspace-to-publication journey with failure/retry, pause/resume, restoration, and shared counts. Render checks cover the corresponding Content, Pipeline, Scheduler, Channel, and Dashboard views and handoff controls. These state/store/server-render checks do not replace browser interaction testing.

`npm run test:browser` runs production-browser acceptance through an installed Chrome/Edge using native CDP, without adding dependencies. Build first. Set `CHROME_PATH` if necessary; absence of a browser is reported as SKIP. The suite uses an isolated temporary profile and localhost server, controls its test clock, checks all eight routes at desktop/tablet/mobile widths, and exercises creation through publication, keyboard/dialog behavior, filters, cancellation, restoration and storage failures. Screenshots and JSON results are written to a temporary evidence directory printed by the test. No normal browser profile or application test backdoor is used.

The completed audit, exact checks, changes and remaining limitations are documented in [Phase 2 acceptance report](docs/phase-2-acceptance.md). Shell search delegates to Content; Notifications open activity history; Help explains the mock workflow. Account management and multiple-workspace switching remain explicitly unavailable.

## Validation and feedback

All frontend CRUD saves pass through `src/state/operations.ts` and `src/state/validation.ts` before shared state changes. Rejected operations leave the previous state intact. Form errors identify the fields to correct; unexpected failures use a safe, generic retry message. Forms stay open and retain drafts after errors. While saving, their controls are disabled, repeat submissions are prevented, and a loading message is announced. Successful operations show a dismissible workspace message. Permanent deletes use a confirmation dialog with dependency impact and cancellation.

Names are compared ignoring case and extra whitespace. Channels require unique names and handles; pipelines require unique names; provider names are unique within a category; content titles are unique within a channel. Entity IDs cannot overwrite existing records or change during edits. A pipeline must have at least one step, and enabled pipelines need at least one active step. Step order, unique step IDs, configuration sizes, assigned channels, provider availability, and provider type compatibility are checked. Optional mock provider assignments may remain blank. Disabled providers keep their step assignments; affected enabled pipelines display Needs attention and cannot be selected for new work until fixed.

Content starts as Idea and follows Idea → Script → Generating → Editing → Ready → Scheduled → Published. Ready content can also be marked Published directly. Supported review/unschedule/retry transitions are defined in `transitions`; Published is terminal, and Failed content can return to a preparation/review stage. Mock status changes perform no actual generation or uploads.

New or changed planned dates must be real, complete future dates and times in the workspace timezone. An unchanged historical date is preserved during ordinary edits. Preferences require valid selections and publishing times; missing default selections may be left blank. Removed selections are shown as unavailable instead of silently appearing blank. Provider credential fields stay disabled, and unsupported provider fields are rejected.
