Provider foundation (Phase 4A)

Existing authenticated, owner-scoped `/api/v1/ai-providers` CRUD is retained.
POST/PATCH accept optional `apiKey` (write-only): omit to retain, supply a
nonempty string to replace, or null to delete. DELETE removes the configuration
and its credential subject to the existing relationship restrictions. All writes
require the existing session cookie and CSRF header. Provider list/detail and
workspace responses contain metadata only, never credentials or ciphertext.

`adapterId` defaults to `mock`. Live connection adapters are OpenAI, Anthropic,
ElevenLabs, Stability AI and Runway. Saving a configuration or key does not verify
credentials. Models/category/enabled remain the existing PostgreSQL configuration
fields. No arbitrary endpoint URL is accepted.

Setup, from the server directory:

1. Generate an independent key with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
2. Set `PROVIDER_ENCRYPTION_KEY` in your server-only `.env`. Never use a VITE_
   variable, commit the key, or reuse SESSION_SECRET.
3. Run `npm run db:generate` and `npm run db:migrate`, then restart the backend.

The additive `20261108000000_provider_credentials` migration preserves existing
provider rows and adds a dedicated credential table with an owner-bound foreign
key and cascade deletion. Credential updates commit atomically with provider
updates and activities. AES-256-GCM uses random 12-byte nonces, 16-byte tags,
and versioned associated data binding user and provider IDs. Missing encryption
configuration fails credential writes with 503 and rolls back metadata changes;
metadata-only operations and credential removal remain available.

Back up the encryption key separately from the database. Changing it prevents
decrypting existing credentials. Automated key rotation/re-encryption is not part
of this phase. If a database URL/password was previously committed in an example
file, replacing that example cannot remove Git history: rotate that credential.

The existing provider dialog uses transient component state for write-only input;
keys go directly through the API mutation and never enter workspace entity state
or localStorage. Blank input retains an existing key; the removal checkbox deletes
it. Connection tests remain clearly simulated. Deploy over HTTPS for transport
protection (local HTTP is only for development).

Focused verification: `node --import tsx tests/providers.acceptance.ts` and
`npm run typecheck` in server; frontend `tsc -p tsconfig.app.json --noEmit`.
Tests generate disposable random credentials and use the existing disposable SQL
fixture, not configured PostgreSQL or real API keys.


Phase 4B connection checks

POST /api/v1/ai-providers/:id/test-connection validates the stored credential.
It requires an authenticated owner, CSRF, an enabled real adapter and a saved key.
The per-process endpoint limit is 10 requests/IP/minute; overlapping tests for
one owner/provider are rejected. No automatic retries or paid generation probes.
The existing provider row Test button invokes this endpoint. The form's Validate
fields button only checks draft fields. Explicitly select the API service when
configuring older mock records: names/models are never used to guess a service.

Success stores connected=true and lastConnectedAt and writes an activity. Upstream
failure stores connected=false, retains the last successful timestamp and writes
a safe activity code. Changing/removing a key or changing adapter clears both.
Clients cannot set connected=true for a real adapter. Updates during a test
invalidate its result, preventing stale credentials from being marked verified.
Existing mock records retain mock status semantics; they are not live connections.

Requests use fixed HTTPS URLs, provider-specific authentication headers, reject
redirects, time out after 10 seconds including body reading, and cap response size
at 1 MiB. Upstream errors/bodies/headers never go to the browser or activity logs.
401 is mapped to a provider-specific 422 (so it does not log out the application
session); 403 reports missing permission, 429 reports rate limiting, 5xx reports
unavailability and timeouts report 504. Restricted keys must permit the selected
read-only check. No SDK or other dependency was installed.

Read-only checks (official references):
- OpenAI: GET /v1/models, Bearer authentication:
  https://developers.openai.com/api/reference/overview
- Anthropic: GET /v1/models?limit=1, x-api-key and anthropic-version 2023-06-01:
  https://platform.claude.com/docs/en/api/models/list
- ElevenLabs: GET /v1/user, xi-api-key:
  https://elevenlabs.io/docs/api-reference/user/get
- Stability AI: GET /v1/user/account, Bearer:
  https://prod-nlb.stability.ai/docs
- Runway: GET /v1/organization, Bearer and X-Runway-Version 2024-11-06:
  https://docs.dev.runwayml.com/api/

Apply the additive 20261108010000_provider_connections migration with
npm run db:migrate from server, then restart the backend. It adds a nullable
lastConnectedAt; historical mock connected flags are not evidence of live checks.
No local environment files or live credentials were used by automated tests.

Focused checks: tests/provider-connections.test.ts (mocked adapters/error cases),
tests/providers.acceptance.ts (HTTP authentication/encryption/CRUD/status and
persisted connection timestamps using disposable SQL), backend typecheck, and
frontend TypeScript check. Live provider testing remains pending; no generation
access, specific model access, account quota or billing status is guaranteed by
a successful metadata/account check.

Voyage and other model names in legacy mock data are not live integrations. A
non-generating Voyage credential probe was not verified in official documentation;
no speculative endpoint or paid embedding probe was added. Phase 4C still needs
its separately scoped processing/generation integration, model capability/access
validation and pipeline consumption. No video generation, YouTube or workers here.

Phase 4C model selection

GET /api/v1/ai-provider-catalog requires the existing authenticated session and
returns a small, maintained catalog: source=maintained, reviewedAt=2026-11-08,
accountAccessVerified=false, and providers with documented canonical model IDs,
display names, categories and official source URLs. It does not claim that every
catalog model is accessible to every account. No provider credentials are needed
to browse this catalog and no live provider calls occur on browsing or saving.
The maintained subset lives in src/services/providers/catalog.ts and requires
periodic review against provider deprecations; it is not an exhaustive list.

The provider dialog loads this endpoint through src/api/providers.ts and the
existing credentialed API client. Service and type filter the model options;
loading, retry, empty and unavailable-current-model states reuse existing styles.
Existing unknown IDs are retained in storage and shown as unavailable rather than
silently rewritten. New/changed real selections must exactly match a catalog ID
and category. Mock records retain their previous configuration behavior.

The chosen model is the first entry of the existing AIProvider.models array.
Provider configuration CRUD already persists adapterId/category/models per owner;
there is no schema change or new migration in Phase 4C. Settings' existing text,
voice and image defaults persist the preferred provider ID; they therefore use
that provider's saved model. The backend requires an enabled, connected real
provider with a supported model before accepting it as a default. Disconnected
providers may still be saved as configurations so they can subsequently be tested.
Other categories retain per-configuration selections without new global defaults.
Ownership is enforced for updates/deletes and default-provider references.

Focused verification: existing tests/providers.acceptance.ts now exercises the
catalog via the actual frontend API client/repository, canonical write DTOs,
invalid IDs/categories, disconnected default rejection, SQL persistence and
restoration of model/default selections, owner isolation and credential secrecy.
The Phase 4B mocked HTTP adapter tests also remain applicable. No paid/live
provider checks or generation are needed for these tests.

Model sources reviewed for this maintained subset:
- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://developers.openai.com/api/docs/models/gpt-4o-mini-tts
- https://developers.openai.com/api/docs/models/gpt-image-1
- https://developers.openai.com/api/docs/models/text-embedding-3-small
- https://platform.claude.com/docs/en/models/overview
- https://elevenlabs.io/docs/overview/models
- https://docs.stability.ai/api-reference/sdxl-10/text-to-image
- https://docs.dev.runwayml.com/guides/models/

Phase 4D remains separate: actual generation/processing and pipeline consumption
of these selections. Account-specific capability/quota verification is still
pending; a metadata connection check alone does not guarantee generation access.

Phase 4E frontend completion

The existing provider page now distinguishes verified real connections (connected
plus lastConnectedAt) from unverified or mock records. Summary counts exclude
mock connections. The table displays the preferred first model and formats Last
Used from server request activity. Tests show pending state and safe success or
failure feedback; disabled/mock profiles cannot run misleading live tests.
Saving, updates, key removal, model catalog loading/retry and confirmed deletion
reuse the existing account-backed store, editors and dialog components.

Existing endpoints used by the UI:
- GET /api/v1/workspace for provider state and refreshed mutation results.
- POST/PATCH/DELETE /api/v1/ai-providers[/:id] for configuration/key management.
- POST /api/v1/ai-providers/:id/test-connection for saved credential checks.
- GET /api/v1/ai-provider-catalog for provider/model choices.
- PATCH /api/v1/preferences for existing Settings defaults.
- GET /api/v1/ai/usage?page=1&limit=25 for the Analytics footer.

AI usage reuses the existing Analytics footer, separate from video/chart filters.
It shows the latest 25 records' outcomes and reported tokens, identifies missing
token counts and unknown costs, and includes explicit loading/empty/error/retry
and manual refresh states. The all-time request count comes from pagination;
recent token/outcome summaries are explicitly scoped to the displayed page.
It performs no generation calls, no paid tests, and no automatic polling loop.
Requests abort on unmount/account changes and usage stays in component memory.
No key is returned to inputs or persisted in browser storage; key entry remains a
masked, transient write-only field. The backend now records lastUsedAt when it
reserves an actual generation attempt so Last Used reflects real request activity.

Focused verification extends tests/providers.acceptance.ts through the actual
frontend client and usage/status helpers: configuration save/model selection,
connection testing and failure, encrypted key updates/removal, selected model
restoration, usage display data, and separate authenticated account isolation.
Both frontend and backend TypeScript checks apply. Upstream responses are mocked;
full browser click-through and live credential acceptance remain pending for
Phase 4F. No schema migration, new dependency, CSS or layout change in Phase 4E.
