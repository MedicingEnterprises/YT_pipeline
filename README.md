# Content Hub

Content Hub is a responsive frontend foundation for a creator workspace. It currently uses shared in-memory application state and interactive mock CRUD workflows.

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

## Preview scope

There is no backend, database, authentication, OAuth, YouTube API, real AI, video generation, or upload service. All changes survive navigation within the current tab and reset on refresh. Nothing is written to browser storage. Provider credential fields are disabled; simulated connection tests never contact a provider.

- Channels: create, edit settings, mock connect/disconnect, and delete empty channels. Reassign or delete a channel's content before deleting it.
- Providers: add, configure, enable/disable, validate mock configuration, and delete. Deletion clears pipeline assignments and preference defaults.
- Content: create from the header, dashboard, or library; edit title, notes, format, visibility, channel, pipeline, status, and planned date; delete with dependent schedules.
- Pipelines: create, edit, delete, assign channels, add/remove/reorder/configure steps, and enable/disable flows or steps.
- Scheduler: create a schedule for content, change the associated item/status/time, reschedule, and delete. One mock schedule per content item. New schedules require Ready content; mock-connected channels and valid enabled pipelines are required for scheduling and publishing. Schedule status maps to content status: Scheduled → Scheduled, Ready → Ready, Processing → Generating, Needs attention → Failed. Publishing a mock content item removes its pending schedule.
- Settings: save shared preferences; workspace name, appearance, density, reduced motion, notification choices, and new-content/provider defaults are applied in memory. Account/security controls remain unavailable.
- Dashboard, channel summaries, selectors, sidebar counts, and analytics labels use shared state. Analytics measurements remain illustrative fixtures.

Deleting a pipeline retains its content and clears pipeline links. Deleting content removes its schedules, jobs, analytics rows, and related activity. Dates in mock schedules represent wall-clock times in the saved workspace timezone; no scheduling service runs.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test` checks relationship mutations, application validation, content transitions, atomic failure behavior, store actions, confirmation/cancellation, and renders pages, editors, and feedback states with populated and empty collections. It does not replace browser interaction testing.

## Validation and feedback

All frontend CRUD saves pass through `src/state/operations.ts` and `src/state/validation.ts` before shared state changes. Rejected operations leave the previous state intact. Form errors identify the fields to correct; unexpected failures use a safe, generic retry message. Forms stay open and retain drafts after errors. While saving, their controls are disabled, repeat submissions are prevented, and a loading message is announced. Successful operations show a dismissible workspace message. Permanent deletes use a confirmation dialog with dependency impact and cancellation.

Names are compared ignoring case and extra whitespace. Channels require unique names and handles; pipelines require unique names; provider names are unique within a category; content titles are unique within a channel. Entity IDs cannot overwrite existing records or change during edits. A pipeline must have at least one step, and enabled pipelines need at least one active step. Step order, unique step IDs, configuration sizes, assigned channels, provider availability, and provider type compatibility are checked. Optional mock provider assignments may remain blank. Disabled providers keep their step assignments; affected enabled pipelines display Needs attention and cannot be selected for new work until fixed.

Content starts as Idea and follows Idea → Script → Generating → Editing → Ready → Scheduled → Published. Ready content can also be marked Published directly. Supported review/unschedule/retry transitions are defined in `transitions`; Published is terminal, and Failed content can return to a preparation/review stage. Mock status changes perform no actual generation or uploads.

New or changed planned dates must be real, complete future dates and times in the workspace timezone. An unchanged historical date is preserved during ordinary edits. Preferences require valid selections and publishing times; missing default selections may be left blank. Removed selections are shown as unavailable instead of silently appearing blank. Provider credential fields stay disabled, and unsupported provider fields are rejected.
