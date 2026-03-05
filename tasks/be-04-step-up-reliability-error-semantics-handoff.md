# BE-04: Step-Up Reliability and Error Semantics Handoff

Date: March 5, 2026  
Owner: BE  
Status: Completed (handoff documented)

## Summary

This handoff defines the backend step-up contract used by sensitive super-admin actions, with explicit FE-consumable error semantics and reliability expectations.

## In-Scope Endpoints

- Step-up issuance:
  - `POST /api/v1/auth/step-up`
- Step-up protected actions relevant to FE super-admin flow:
  - `POST /api/v1/customers/:customerId/admins/replace`
  - `POST /api/v1/super-admin/invitations/:invitationId/revoke`

## Current Step-Up Token Contract

- Header name for protected endpoints: `X-Step-Up-Token`
- Token is:
  - user-bound (`stepup:${userId}:${tokenHash}`)
  - one-time use (deleted after successful validation)
  - short-lived (`expiresIn = 900` seconds from issuance)
- Issuance success response:
  - `200`
  - `data.stepUpToken`
  - `data.expiresIn` (currently `900`)
  - `meta.requestId`

## Stable Error Semantics (FE Mapping Contract)

### `POST /api/v1/auth/step-up`

- `401 STEP_UP_INVALID_CREDENTIALS`
  - Current password is incorrect.
- `503 STEP_UP_UNAVAILABLE`
  - Step-up service dependency unavailable.
- `401 UNAUTHENTICATED`
  - Session/user context invalid.
- `422 VALIDATION_FAILED`
  - Missing/invalid request body (`password`).

### Step-up protected endpoints (`replace`, `revoke`)

- `403 STEP_UP_REQUIRED`
  - Missing `X-Step-Up-Token`.
- `403 STEP_UP_INVALID`
  - Token invalid, expired, or already consumed.
- `503 STEP_UP_UNAVAILABLE`
  - Step-up verification service dependency unavailable.

Notes:
- `requestId` is included in error responses and should be surfaced by FE.
- For revoke and replace routes, step-up validation runs before business action execution.

## Reliability Expectations (Operational)

- If Redis is unavailable at validation/issuance time, API should return `STEP_UP_UNAVAILABLE` (not a generic auth failure).
- FE should treat step-up tokens as single-use and request a fresh token per sensitive action attempt.
- FE should handle retriable service outages (`STEP_UP_UNAVAILABLE`) with retry guidance and preserve request reference IDs.

## FE Fallback Guidance

- On `STEP_UP_REQUIRED`: prompt step-up immediately.
- On `STEP_UP_INVALID`: require re-auth/step-up again (token expired/used/invalid).
- On `STEP_UP_UNAVAILABLE`: show temporary service issue guidance and retry option.
- For `replace` and `revoke`, do not auto-retry the mutation without obtaining a fresh step-up token after invalid/expired errors.

## Observability and Support

- Use `requestId` in support/debug handoff for all step-up failures.
- Expected operator triage for `STEP_UP_UNAVAILABLE`:
  - verify Redis connectivity and health
  - verify auth service process health
  - retry after dependency recovery

## Known Follow-Up Gap (Recommended)

- Current implementation guarantees deterministic `STEP_UP_UNAVAILABLE` when Redis client is absent.
- Additional hardening is recommended to normalize runtime Redis command failures (`get`/`set`/`del`) to `STEP_UP_UNAVAILABLE` instead of generic `500 INTERNAL_ERROR`.
- Recommended follow-up:
  - wrap step-up Redis operations with explicit error translation
  - add contract tests for availability/invalid/required branches on both replace-admin and invitation revoke paths

## Implementation References

- `src/controllers/auth.controller.js`
- `src/middleware/requireStepUp.js`
- `src/routes/customers.routes.js`
- `src/routes/invitations.routes.js`
- `src/validators/auth.validator.js`
