# Authentication and backend security

## Configure and deploy

Apply both committed Prisma migrations with `npm run db:migrate`, then generate the client with `npm run db:generate`. No existing user is given a password by the migration or seed. Legacy/sample accounts have a null passwordHash and cannot log in. Register a new account to use the API; no development identity bypass remains.

Set SESSION_SECRET to **32 cryptographically random bytes encoded as base64url**. Generate a value locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Put the result in the ignored server `.env` or your deployment secret manager. There is no built-in/default secret. All instances must use the same secret. Rotation immediately invalidates session hashes and CSRF proofs; it does not change password hashes. Do not commit, log or put this value in frontend environment variables.

- SESSION_HOURS: absolute lifetime, default 24, range 1–168 hours.
- SESSION_IDLE_MINUTES: idle lifetime, default 30, range 1–1440 minutes, capped by absolute expiry.
- SESSION_COOKIE_SECURE: local HTTP may use false only on a loopback HOST. Production requires Secure cookies regardless of defaults and rejects an explicit false.
- APP_ORIGINS: comma-separated exact origins, no wildcard/path/query/trailing slash. Production requires explicit HTTPS origins. Development defaults allow localhost/127.0.0.1 on ports 5173 and 3001.
- DEV_USER_ID is rejected. DATABASE_URL remains server-only. `.env.example` contains placeholders only.

Use HTTPS in production (typically terminated by a trusted reverse proxy with the backend reachable only internally). Cookies are host-only, Path=/, HttpOnly, SameSite=Lax. Secure configurations use `__Host-content-hub-session` and `__Host-content-hub-csrf`; local HTTP names omit `__Host-`. Do not set a Domain attribute. The deployment must be same-site for SameSite=Lax browser cookies; use consistent local hostnames and same-site HTTPS frontend/API hosts. Different origins still require the explicit CORS allowlist.

Fastify does not trust proxy/X-Forwarded-For headers by default. Rate limiting therefore uses the actual socket peer. A reverse proxy deployment needs a carefully scoped trusted-proxy/shared-limiter strategy; do not enable blanket proxy trust. Multi-instance auth rate limits are currently per process, not distributed.

## Browser protocol

1. Fetch `GET /api/v1/auth/csrf` with `credentials: 'include'`. It returns `{data:{csrfToken}}` and sets a signed ten-minute HttpOnly anonymous protection cookie if signed out.
2. POST registration/login JSON with `credentials: 'include'` and `X-CSRF-Token` set to that proof. Login CSRF and registration CSRF are protected even without an existing session.
3. Success sets a fresh HttpOnly session cookie. JSON contains only a public user profile and absolute expiresAt; no session token/password hash is returned. Any previously presented session is invalidated.
4. Fetch `/auth/csrf` again after login/rotation. Keep this session-specific proof in memory and include it in every POST/PATCH/PUT/DELETE request to protected APIs. It is a CSRF proof, not a session credential. Do not put it in URLs.
5. Fetch `GET /auth/me` to restore the signed-in profile. Cookies plus database sessions survive application restart when database/secret are preserved.

Unknown/expired/revoked sessions return 401 and clear cookies. Missing/wrong CSRF proofs return 403. Session tokens cannot be supplied via query strings, X-User-Id or bearer headers. An explicitly configured Origin allowlist applies before authentication; forbidden origins return 403. Browsers receive allow-credentials only for approved origins and headers.

## Endpoints

All paths below are relative to `/api/v1/auth`. Responses use the existing `{data:...}` / `{error:{code,message,requestId}}` envelopes and Cache-Control: no-store.

| Method/path | Body | Result |
| --- | --- | --- |
| GET `/csrf` | none | 200 `{data:{csrfToken}}`; public but origin-restricted/rate-limited |
| POST `/register` | email, displayName, password | 201 `{data:{user,expiresAt}}`, rotated cookie; anonymous/session CSRF required |
| POST `/login` | email, password | 200 `{data:{user,expiresAt}}`, rotated cookie; anonymous/session CSRF required |
| POST `/logout` | none | 204; revoke current session and clear cookies |
| POST `/logout-all` | none | 204; revoke all current user's sessions |
| GET `/me` | none | 200 `{data:{id,email,displayName,createdAt,updatedAt}}` |
| PATCH `/me` | displayName and/or email; currentPassword required when changing email | 200 public profile; changed email revokes all sessions and clears cookies |
| PUT `/password` | currentPassword, newPassword | 204; revoke all sessions and require login again |

All except CSRF/register/login require an authenticated session. All writes require a matching CSRF header. No raw session enumeration or credential API exists. Profile fields are allowlisted: attempts to set role, privileges, userId, id or passwordHash are rejected. No authorization role can be changed through this API.

New passwords require 15–128 characters, with at most 512 UTF-8 bytes. No trimming, case conversion, truncation or restrictive character composition is applied. Email addresses are normalized to lowercase. Passwords use async Node scrypt, N=131072, r=8, p=1, random 16-byte salt, 64-byte key and constant-time comparison. The encoded hash records algorithm/parameters. Work is bounded to two active derivations and eight waiting requests to limit memory exhaustion. Unknown/passwordless accounts perform the same derivation and return the same login error as incorrect passwords.

PostgreSQL stores only HMAC-SHA256 hashes of random 32-byte session tokens, not cookie values. CSRF proofs use a separate domain-separated HMAC. Credential/session issuance serializes with sensitive profile/password changes; obsolete password verifications cannot create sessions after a password change. Absolute and sliding idle expiry are checked on every authenticated request. Expired sessions for a user are pruned at that user's next login; abandoned expired rows can be deleted periodically by deployment maintenance. There is no background cleanup worker.

## Other protections and boundaries

- Existing owner-scoped service queries and composite foreign keys isolate every resource. Cross-owner resources/references return 404, never transfer ownership. Authentication is resolved from the session only.
- Registration creates user/preferences atomically. Sensitive credential changes and session revocation are transactional. Password hashes/token hashes are excluded from public user queries. Seed data contains no login credentials.
- Strict request schemas reject unknown fields. Errors hide driver queries, submitted values and internal stacks. 401 covers invalid credentials/session; 403 CSRF/Origin failures; 409 duplicate registration/relationship conflicts; 429 rate limiting; 503 bounded auth capacity or database unavailability.
- Authentication credential routes (register/login/profile/password/logout-all) share 10 requests per socket IP per 15 minutes. CSRF permits 60/minute; logout permits 30/minute. Limits apply before body parsing/validation, including invalid requests, and return Retry-After. These bounded in-memory limits reset on process restart and are not a distributed anti-abuse system.
- Helmet applies CSP, frame protection, nosniff/referrer policies and related headers; production adds HSTS. CORS allows only configured origins and Content-Type/X-CSRF-Token for credentialed browser writes.
- Structured request logs omit headers, bodies and query strings. Error serializers suppress raw messages/stacks that could embed SQL parameters or credentials. Redaction additionally covers cookies/authorization and common password/token/config-secret fields.

This implements the requested backend account/session system. Frontend login screens/API wiring, email ownership verification, password recovery, MFA, CAPTCHA, breached-password checking and shared distributed rate limiting are not included. No Google OAuth, YouTube authorization or real provider credentials are added. No external production security assessment is claimed.

Password/session choices follow [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) and [session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Focused verification

`npm run test:auth` uses real Fastify/Prisma against disposable embedded PostgreSQL SQL, including both migrations. It checks account/CSRF/session lifecycle, hashing, profile restrictions, owner isolation, restart/secret rotation, idle/absolute expiry, revocation, secure cookie flags, CORS/security headers and rate limiting. `npm run test:api` checks existing resource operations with actual authenticated sessions. Neither command runs the complete frontend/application suite. Live PostgreSQL deployment, real browser cookie transport and multi-connection concurrency require environment-specific checks.

Phase 3D checks passed: 85 authentication/security HTTP assertions plus credential-race checks, 88 resource API HTTP assertions with cookie/CSRF authentication, Prisma schema validation/client generation and backend TypeScript checks. The complete application suite, lint and production build were not run. Frontend visuals and the pre-existing root package-lock.json modification were preserved.
