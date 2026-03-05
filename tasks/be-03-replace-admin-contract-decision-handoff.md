# BE-03: Replace-Admin Contract Decision Handoff

Date: March 5, 2026  
Owner: BE  
Status: Completed

## Decision

`POST /api/v1/customers/:customerId/admins/replace` remains a **`newUserId`-based existing-user contract** in v1.

It does **not** evolve to name/email + invitation semantics for v1.

## Rationale

- FE-11 explicitly clarifies replace-admin is for existing identities.
- Invitation/user-creation flows are already handled by:
  - `POST /api/v1/customers/:customerId/admin-invitations`
  - `POST /api/v1/customers/:customerId/admins` (existing assign path)
- Keeping replace-admin focused avoids mixed side effects and preserves canonical-admin invariants.

## Canonical API Contract (v1)

- Endpoint: `POST /api/v1/customers/:customerId/admins/replace`
- Auth: `SUPER_ADMIN` JWT required
- Step-up: `X-Step-Up-Token` required
- Request body:
  - `newUserId` (ObjectId string, required)
  - `reason` (string, required, 1-500)
- Success (`200`):
  - `data.message`
  - `data.customerId`
  - `data.oldUserId`
  - `data.newUserId`
  - `data.canonicalAdminUserId`
  - `meta.requestId`
  - `meta.version`

## Error Semantics (current stable behavior)

- `403 STEP_UP_REQUIRED`: missing step-up token
- `403 STEP_UP_INVALID`: invalid/expired token
- `503 STEP_UP_UNAVAILABLE`: step-up service unavailable
- `422 VALIDATION_FAILED`: request validation fails or inactive target user
- `404 NOT_FOUND`: customer/user missing
- `409 CONFLICT`: governance invariants block replacement

Responses include `error.requestId`; governance conflicts may include `error.details`.

## Behavioral Guarantees

- Replace-admin does not create users.
- Replace-admin does not create invitations.
- On success, canonical admin pointer is set to `newUserId`.
- New user is ensured to have `CUSTOMER_ADMIN` membership for the customer.
- Old canonical admin loses `CUSTOMER_ADMIN` membership when old/new differ.

## Migration Notes

- No migration required for FE based on this decision.
- FE should continue:
  - replace-admin for existing user IDs
  - assign-admin/invitation flow for new identities

## Implementation References

- `src/routes/customers.routes.js`
- `src/validators/customer.validator.js`
- `src/controllers/customer.controller.js`
- `src/services/customerGovernanceService.js`
- `src/middleware/requireStepUp.js`
