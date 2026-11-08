Phase 4D: text requests and usage

Apply the additive `20261108020000_ai_usage` migration with
`npm.cmd --prefix server run db:migrate` from the repository root, then restart
the backend. No environment files are changed. The existing provider encryption
key and configured, connected provider credentials are required for live use.

API contract

All endpoints require the existing session cookie; POST also requires CSRF.
`POST /api/v1/ai/text` accepts:

```json
{
  "requestId": "a-client-generated-unique-UUID",
  "providerId": "optional-owned-provider-UUID",
  "model": "optional-configured-model-ID",
  "prompt": "Text to send",
  "systemPrompt": "Optional instructions",
  "maxOutputTokens": 512,
  "temperature": 0.5
}
```

Omit providerId to use the user's saved default text provider. Omit model to use
that provider's first configured model. Providers must be enabled, connected,
text-category records owned by the authenticated user. Models must belong to
both the provider configuration and Phase 4C catalog. Only OpenAI and Anthropic
text adapters support generation; speech/image/video adapters remain unchanged.
Temperature is optional and supported only by the configured OpenAI text model;
it is rejected explicitly for the current Anthropic catalog model.

Success is `{data: {requestId, usageId, providerId, provider, model, text,
finishReason, usage}}`. finishReason is stop or length (output token cap reached).
usage contains nullable inputTokens, outputTokens, cacheReadTokens,
cacheWriteTokens and estimatedCostUsd. Missing token counts are unknown, not zero.
Anthropic cached counts remain separate from its reported input count; no
unsupported total-token arithmetic is performed. Estimated cost is always null:
no verified/versioned pricing or billing agreement is configured in this phase.

Only generated text and allowlisted metadata are returned. Reasoning, tool blocks,
provider headers, errors, identifiers and raw payloads are not returned. Generated
content containing the active API key, master key or session secret is rejected.
Prompts containing these known secrets are rejected before transmission. Application
logs omit request bodies and raw errors; no generation content is logged.

`GET /api/v1/ai/usage?page=1&limit=25&requestId=optional-UUID` returns paginated
owned usage records with the normal data/pagination envelope. It never returns
prompts or generated text. Unauthenticated requests are denied; another user's
requestId reveals no records. Existing OpenAPI documentation includes both routes.

Limits and recovery

- Prompt maximum 12000 characters; optional system prompt maximum 4000.
- Output budget 64–2048 tokens, default 512; temperature 0–1 where supported.
- 30-second upstream deadline, 1 MiB response cap, 65536-character output cap.
- Fixed HTTPS POST endpoints, redirect rejection, streaming disabled, no tools,
  no automatic retries, no background execution and no request loops.
- Per-process HTTP limit: 10 requests/IP/minute. PostgreSQL reservations enforce
  one active request/user, 5 attempts/user/minute and 50 attempts/user/UTC day
  across instances/restarts. Failed attempts count toward these limits too.
- A required requestId is unique per user and reserved before the external call.
  Reusing it returns 409 without another call; results are not cached/replayed.
  This blocks accidental duplicate charges, rather than promising provider-side
  exactly-once billing. A new requestId permits another explicitly requested call.
- Reservations older than 60 seconds without a recorded outcome appear UNKNOWN
  in history and are persisted as UNKNOWN on the next accepted reservation.
  They are never automatically retried. A timeout or UNKNOWN status may still
  represent a billed provider operation. Inspect usage before retrying manually.
- If usage finalization fails, return 503 USAGE_PERSISTENCE_FAILED; never repeat
  the external call. A database reservation failure prevents the call entirely.

AIUsage has a user foreign key, user/requestId uniqueness, owner/time index,
nonnegative token/cost constraints and completion timestamp checks. Provider/model
IDs are immutable historical snapshots, intentionally not live provider foreign
keys: provider deletion cannot destroy usage history. Workspace reset retains
usage, so it cannot bypass request limits. User deletion cascades owned usage.
Malformed/unauthorized/unconfigured requests rejected before reservation do not
create usage records; reserved downstream attempts record success or safe failure.

Provider errors use stable safe application codes: invalid credentials -> 422,
rate limit or unavailable upstream -> 503, timeout -> 504, malformed/unsafe
responses or transport failures -> 502. Provider bodies and credentials are
discarded, not copied into error messages or usage. These provider errors do not
turn into an application-session 401. Provider failures do not automatically
rewrite connection-test status, because transient failures do not prove a bad key.

Verification

`node --import tsx tests/ai-requests.acceptance.ts` from server uses mocked HTTP
responses and the existing disposable SQL fixture. It covers both providers,
default/model selection, usage persistence/restoration, missing authentication,
CSRF and ownership, upstream failures/timeouts/malformed responses, secret echo
rejection, duplicate/concurrent calls and database minute/day/restart limits.
`npm run typecheck` checks backend TypeScript. No paid calls, live database,
new dependency, frontend changes or entire test-suite run are required.

Official request references:
- https://developers.openai.com/api/docs/guides/text
- https://platform.claude.com/docs/en/api/messages/create

Phase 4E remains separate: connect generation to content/pipeline features under
its own scope. Live account/model access verification, pricing, streaming and
media generation are not established by these mocked tests. This phase adds no
video processing, YouTube integration or production worker.
