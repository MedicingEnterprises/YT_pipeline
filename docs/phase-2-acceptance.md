# Phase 2 acceptance report

Audit date: 5 November 2026. Scope: the browser-based mock application, through simulated publication. Result: **PASS within the tested prototype scope**. Phase 3 has not been started.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Complete Node test suite | 106 passed, 0 failed |
| Server-render/store integration checks | Passed, including all eight pages, empty/populated collections, feedback, restoration, shared workflow views and zero-view analytics |
| TypeScript (`npm run typecheck`) | Passed |
| Oxlint (`npm run lint`) | Passed without warnings |
| Production build (`npm run build`) | Passed |
| Whitespace (`git diff --check`) | Passed |
| Production browser acceptance | 14 groups passed in Chrome 156.0.8078.80 on Windows |
| Responsive route checks | All eight routes at 1440, 768 and 390 CSS pixels; no horizontal page overflow |
| Keyboard/mobile-dialog checks | Focus entry, Tab containment, Escape, focus restoration/cleanup, inert closed mobile navigation, repeated mobile search |
| Browser runtime diagnostics | No page console errors or unhandled page exceptions recorded |
| Application network diagnostics | No external HTTP/API requests recorded |

The browser checks use the installed browser and Node's native WebSocket/CDP support. No browser-testing package or application dependency was installed. Chrome runs headlessly with a new temporary profile and a localhost production-preview server. The restricted execution environment required permission to launch a working renderer outside its restriction. The user's normal browser profile is never used.

The test controls time through a CDP script confined to its isolated browser profile, allowing future scheduling and recovery to be checked deterministically. No test clock or test-only interface was added to production application code. Browser timezone is Pacific/Auckland while the workspace uses Asia/Colombo, verifying that planned times do not follow the PC/browser timezone.

Latest browser evidence: `C:\Users\admin\AppData\Local\Temp\content-hub-acceptance-DsAUe3`. This directory contains `results.json`, desktop/tablet/mobile Settings screenshots, a Ready-content mobile screenshot, a published Dashboard screenshot, and the isolated test profile. Screenshot samples were visually inspected as well as checked for viewport overflow.

## Page and control audit

| Page | Verified behavior |
| --- | --- |
| Dashboard | Entity/job counters derive from workspace state; paused jobs are distinct from processing; upcoming uploads, activity history, channel summaries, creation and content links work. Notifications open actual activity history. |
| Channels | Creation/editing, required/duplicate/day validation, mock connection toggles, connected/disconnected filtering, associated content links, derived publication/schedule counts and guarded deletion. Browser checks include invalid duplicate weekdays, correction, and persistence. |
| AI Providers | Mock profile CRUD, category/model controls, configuration validation, mock connection test, enable/disable, category filtering, dependency protection and cleanup. Credential entry remains deliberately disabled. |
| Pipelines | Configuration, channel assignments, provider compatibility, instructions, ordered/disabled steps, add/remove/reorder controls, enable/disable, details, execution progress, failure controls and protected definitions. Browser checks assign a real mock profile, edit instructions, reorder steps and add/remove a step. |
| Content | Create/edit/delete, filters/search, channel/pipeline selection, initial Idea state, direct Details handoff, step/provider inspection, progress, pause/resume/cancel/failure/retry, Ready review and scheduling. Unavailable item links render a recovery state. |
| Scheduler | Ready-content selection, publication/pipeline modes, future-date validation, rescheduling/deletion, filters, week/month views, due-job dispatch, queue states, cancellation, retry and retained history. Prepared content is published without rerunning its completed pipeline. |
| Analytics | Fixture-based aggregation and filters, populated/empty views, charts and zero-view results. Zero denominators cannot produce NaN; an unsupported fixed comparison percentage was removed. Measurements remain clearly marked illustrative. |
| Settings | Saved workspace/default/timezone/theme/density/motion/notification choices, restoration, validation, reset of unsaved changes, deliberate workspace reset with confirmation/cancellation and storage-failure recovery. Account/security actions are explicitly unavailable. |

Shell control audit: search delegates to the existing Content filter, including a mobile focus target and Ctrl+K. Help displays the existing workflow guidance. Unsupported workspace switching and profile management are disabled with explanatory titles. Footer readiness now reflects persistence errors, failed jobs and processing state rather than a fixed success claim.

Not every possible combination of controls is exercised by browser automation. Source inspection and the unit/store/render suites supplement the production-browser path and filter/control checks. Loading and error-state rendering and duplicate-submit prevention are covered by the automated feedback tests.

## Complete workflow exercised

1. Confirm/cancel workspace reset and then reset the isolated test workspace.
2. Create and edit a channel, correct validation errors, mock-connect it and verify filtering.
3. Create, validate, test, disable/re-enable and select a mock provider.
4. Create a pipeline, assign that provider, configure instructions and exercise ordering/add/remove controls.
5. Create an Idea, assign its channel/pipeline and open Details automatically.
6. Start preparation, pause it, refresh, verify paused restoration and resume.
7. Simulate a failed step, inspect its error and retry from the saved checkpoint.
8. Complete every enabled step; verify that Ready appears only after preparation finishes.
9. Schedule Ready content for a future workspace-local time; verify publication-only mode is selected.
10. Detect the due job, simulate publication and verify Published, completed jobs, activity, Dashboard and Channel state.
11. Verify that preparation ran only once and polling/restoration do not duplicate publication.
12. Separately cancel a run, cancel/confirm content deletion and verify dependent jobs are removed.
13. Save and restore preferences; reset only unsaved edits without resurrecting demo entity selections.
14. Simulate a quota error, verify the previous snapshot is intact, retry saving, and preserve malformed data during failed restoration.

Unit tests additionally cover missing/deleted/disabled/incompatible dependencies, invalid transitions and dates, duplicate IDs/jobs, multiple due items, DST gaps/repeated times, stale-tab guards, native-lock denial/fallback, queue cancellation/retry, version migration, reset failures, unavailable storage, and interrupted-job recovery.

## Issues corrected during this audit

- Review-mode content previously became Ready when Quality check began. It now stays in preparation until all configured steps complete.
- Unexpected queue callbacks could throw synchronously or leak asynchronous errors. They are reported once, automatic work stops, and saved checkpoints remain available for reload.
- Dialog focus handling omitted links and summaries and could include hidden/disabled controls. Focus selection and Tab containment now use visible enabled controls; Channel/Content details and mobile navigation use the shared handler.
- Closed mobile navigation remained keyboard reachable. It is now inert, and the menu exposes expanded/control relationships.
- Shell search, notifications and Help looked actionable without performing their intended action. They now delegate to existing Content/history/help functions; unsupported account/workspace actions are explicitly disabled.
- Fixed footer readiness could claim success while saving failed. It now reports actual workspace/job status.
- Reset preview restored obsolete demo IDs. Reset unsaved changes now restores the currently saved preferences and clears draft errors.
- Zero-view analytics could divide by zero; the unsupported fixed previous-period comparison was misleading. Both were corrected.
- Duplicate model-option catalogs were consolidated through the existing adapter.
- Dialog action rows can wrap and long execution identifiers can break within the available width. The original layout/components/color system were preserved.

## Files changed in Phase 2E

Application:

- `src/App.css`
- `src/components/AppShell.tsx`
- `src/components/feedback.tsx`
- `src/components/JobQueue.tsx`
- `src/execution/dispatcher.ts`
- `src/execution/engine.ts`
- `src/state/store.tsx`
- `src/pages.tsx`

Verification/documentation:

- `tests/browser.mjs` (new)
- `tests/queue.test.mjs`
- `tests/workflow.test.mjs`
- `tests/render.mjs`
- `package.json` (adds `test:browser`)
- `README.md`
- `docs/phase-2-acceptance.md` (new)

The pre-existing `package-lock.json` modification was not changed or discarded; its existing 84-addition/84-deletion diff remains. Earlier phase changes and unrelated working-tree changes remain intact. No dependencies were added.

## Limitations and known bugs

No known acceptance-blocking bug remains in the tested mock workflow. This is not a claim that every possible browser, input or long-running condition has been exhaustively tested.

- Execution requires an open application tab. Browser throttling may delay timers; nothing executes while the browser is closed.
- Persistence is local to the browser profile/origin and subject to quota/availability. There is no backend, backup, database, real AI/media processing, OAuth, YouTube API or upload service.
- Analytics/subscriber measurements are fixtures, not real performance data. Language/digest preferences are saved configuration; full translation and email delivery are not implemented.
- Account/security and multiple-workspace switching are intentionally unavailable. Global search covers Content, not a new cross-entity search service.
- Native Web Locks and stale-snapshot guards reduce conflicting tab work; this is not a distributed queue or live multi-tab synchronization system.
- Activity retains the existing bounded history and notification-preference behavior.
- Automated browser acceptance ran in desktop Chrome with resized viewports and keyboard/mouse input. Firefox, Safari, physical touch devices, a formal screen-reader/contrast audit and prolonged heap/soak profiling were not performed. Keyboard listener cleanup and timer/disposal/error paths were checked.
- Legacy compatibility helpers and fixture adapters were retained instead of performing an unrelated architectural rewrite.

Phase 2 acceptance criteria are satisfied for the documented mock scope: the application reliably supports creation through simulated publication with shared state, validation, persistence, recovery and interactive controls. Backend/Phase 3 development has not begun.

## Reproduce

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:browser
```

`test:browser` uses an installed Chrome/Edge binary, or `CHROME_PATH`. It explicitly reports SKIP if no supported binary exists. It requires permission to launch a headless browser and bind a localhost preview server. It prints its evidence directory and uses no normal user browser data.
