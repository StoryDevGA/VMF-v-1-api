# Technical Specification: Super Admin Licence and Customer Governance

## 1. Overview

Feature summary
- Build Super Admin governance capabilities for licence levels, customer lifecycle, customer admin invariants, tenant and VMF limits, and API-driven customer onboarding.
- Enforce parity between UI and API by centralizing governance rules in shared backend services and validators.

PRD source
- `C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/PRD/prd-super-admin-licence-customer-governance-vFinal.md`

Extracted PRD goals
- Allow Super Admin to create and update licence levels.
- Map licence levels to feature entitlements.
- Govern customer records and lifecycle (active or inactive).
- Guarantee exactly one Customer Admin for every active customer.
- Enforce tenant and VMF limits, especially for service providers.
- Provide atomic external API onboarding for customer plus initial admin user.
- Guarantee complete and immutable audit coverage.

User stories translated
- As a Super Admin, I can create and edit licence levels and their entitlements.
- As a Super Admin, I can create and update customers with licence and limits.
- As a Super Admin, I can set customer lifecycle to inactive and immediately block access.
- As a Super Admin, I can reassign Customer Admin safely without orphaning governance.
- As an external provisioning system, I can create a customer atomically with a valid Customer Admin.

Functional requirements distilled
- Licence levels: create and edit only, no delete.
- Customer lifecycle: active and inactive with immediate effect.
- Customer admin invariant: exactly one active Customer Admin per active customer.
- No customer deletion.
- Tenant creation cannot exceed customer maximum.
- VMF creation cannot exceed per-tenant maximum.
- API onboarding must be all-or-nothing and fail when admin input is invalid.
- Audit records must capture actor, action, target, previous and new values, and timestamp.

Explicit non-goals
- Customer hard delete or archive workflow redesign.
- Billing engine or invoicing implementation.
- Frontend implementation details (this is backend-only technical spec).

Success metrics (technical translation)
- 100 percent of active customers have non-null `licenseLevelId` and `customerAdminUserId`.
- 0 successful authz checks for inactive customers on customer, tenant, VMF, and deal routes.
- 0 successful tenant creations above configured customer limit.
- 100 percent of governance mutations generate audit events with before/after diff.

## 2. Current Stack and Baseline

Runtime and framework baseline
- Node.js `>=18`, Express `4.x`, Mongoose `8.x`, JWT auth, Redis-backed token controls, Zod validators.
- Entry and middleware composition in `src/app.js` and `src/server.js`.

Existing relevant routes
- Customer governance foundation: `src/routes/customers.routes.js`.
- Tenant and VMF hierarchy: `src/routes/tenants.routes.js`, `src/routes/vmfs.routes.js`, `src/routes/deals.routes.js`.
- Auth and scope loading: `src/routes/auth.routes.js`, `src/middleware/authJwt.js`, `src/middleware/loadScopes.js`, `src/middleware/authorize.js`.

Existing models and constraints
- `Customer` contains topology, vmfPolicy, status (`ACTIVE | DISABLED | ARCHIVED`), entitlements, billing, service-provider flag.
- `User` memberships carry roles including `CUSTOMER_ADMIN`.
- `Tenant`/`VMF` models enforce some policy constraints, but no configurable max-tenants or max-vmfs-per-tenant.

Audit and compliance baseline
- `AuditLog` is immutable and HMAC-signed (`src/models/AuditLog.js`).
- `auditService` centralizes write/query/integrity operations (`src/services/auditService.js`).
- TTL retention index configured for 7 years.

Operational baseline
- Performance cache snapshots for user permissions, tenant status, customer topology (`src/services/performanceCacheService.js`).
- Background jobs for reconciliation, audit archival, cache warming (`src/services/backgroundJobService.js`).

Test baseline
- Jest + Supertest with substantial integration-style coverage in `src/__tests__`.
- Existing suites already cover customer/tenant/audit primitives but not licence-level domain.

Baseline gaps against PRD
- No `LicenseLevel` domain model or API.
- No strict one-admin-per-active-customer invariant.
- No global inactive-customer enforcement in authz/login.
- No atomic external onboarding endpoint requiring initial Customer Admin.
- No configurable tenant and VMF limits at customer governance level.

## 3. Scope Mapping

| PRD scope item | Technical deliverable | Primary touchpoints |
|---|---|---|
| Licence level creation and edit | New `LicenseLevel` model, validators, controller, routes | `src/models`, `src/controllers`, `src/routes`, `src/validators` |
| Licence to entitlement mapping | Store entitlement keys on `LicenseLevel`; validate against allowlist | `src/models/LicenseLevel.js`, `src/validators/licenseLevel.validator.js` |
| Customer governance fields | Extend `Customer` with licence reference and limit fields | `src/models/Customer.js`, `src/controllers/customer.controller.js` |
| Active/inactive lifecycle | Normalize API lifecycle semantics and enforce immediate denial | `src/controllers/customer.controller.js`, `src/middleware/authorize.js`, `src/controllers/auth.controller.js` |
| Exactly one Customer Admin | Canonical pointer on customer plus role consistency service | `src/models/Customer.js`, `src/services/customerGovernanceService.js`, `src/controllers/customer.controller.js`, `src/controllers/user.controller.js` |
| Tenant limit enforcement | Enforce max tenants before tenant creation | `src/controllers/tenant.controller.js`, `src/services/customerGovernanceService.js` |
| VMF limit enforcement | Enforce per-tenant VMF maximum at VMF create guard | `src/middleware/topologyGuard.js`, `src/controllers/vmf.controller.js` |
| External onboarding API | New transactional endpoint creating customer plus initial admin | `src/routes/customers.routes.js` (or new super-admin onboarding route), `src/services/provisioningService.js` |
| Audit parity and completeness | Add audit actions and ensure all governance writes emit diffed events | `src/services/auditService.js`, governance controllers |

Technical boundaries (non-goals preserved)
- Do not add customer delete endpoints.
- Do not redesign role model beyond required governance constraints.
- Do not introduce new persistence engines.

## 4. Architecture and Design

### 4.1 High-level design

Component additions
- `LicenseLevel` domain for commercial tier and feature entitlement mapping.
- `customerGovernanceService` for invariant checks and lifecycle enforcement logic.
- Transactional onboarding flow in `provisioningService` for no-partial-create guarantees.

Design choices
- Keep internal customer status enum unchanged (`ACTIVE | DISABLED | ARCHIVED`) to avoid broad regressions.
- Expose governance lifecycle as `ACTIVE | INACTIVE` in new/updated governance APIs.
- Map `INACTIVE` to internal `DISABLED` for compatibility with existing route behavior.
- Introduce `customer.customerAdminUserId` as canonical single-admin reference.

### 4.2 Decision log

| Decision | Option chosen | Why |
|---|---|---|
| Lifecycle representation | API uses `ACTIVE/INACTIVE`; persistence continues `ACTIVE/DISABLED` | Minimizes migration risk and preserves existing controller logic |
| Exactly one Customer Admin | Canonical `customerAdminUserId` on `Customer` plus membership consistency checks | Easier invariant enforcement than counting role memberships on every mutation |
| Licence mapping storage | Entitlements stored on `LicenseLevel`, customer stores `licenseLevelId` | Clear separation of commercial tier from tenant instance |
| Onboarding atomicity | Mongoose session transaction for customer, admin user, membership, defaults | Required by PRD no-partial-create rule |
| Governance parity | Shared service methods reused by UI and API endpoints | Prevents rule drift |

### 4.3 Operational flow summaries

Create or update licence level
1. Validate payload (`name`, `description`, entitlement keys).
2. Persist `LicenseLevel` mutation.
3. Emit audit event with before/after values.

Create customer (UI or API)
1. Validate licence exists and governance limits are valid.
2. Start DB transaction.
3. Create customer with `licenseLevelId`, limits, billing cycle, and active status.
4. Create initial admin user or validate provided existing user.
5. Assign `CUSTOMER_ADMIN` membership and set `customerAdminUserId`.
6. Provision default tenant/VMF via existing provisioning logic as required by topology/vmfPolicy.
7. Commit transaction.
8. Invalidate customer and user permission cache snapshots.
9. Emit audit trail for all created/linked entities.

Set customer inactive
1. Update customer status to `DISABLED`.
2. Invalidate related cache entries.
3. Auth and authz middleware begin rejecting scoped requests immediately.
4. Emit status-change audit with before/after.

Replace Customer Admin
1. Step-up authentication required.
2. Validate new admin user active and belongs to same customer.
3. In a transaction, remove old admin role, assign new admin role, update `customerAdminUserId`.
4. Reject self-removal if replacement not in same transaction.
5. Audit replacement event with reason.

Failure handling
- Transaction rollback on any validation, persistence, or provisioning failure.
- Return deterministic `422`/`409` errors for governance invariant violations.
- Do not continue with partial writes under onboarding flow.

## 5. API Contract

### 5.1 New endpoints: Licence levels

`GET /api/v1/super-admin/licence-levels`
- Auth: `SUPER_ADMIN`
- Response: paginated list of licence levels.

`POST /api/v1/super-admin/licence-levels`
- Auth: `SUPER_ADMIN` + step-up recommended.
- Request
```json
{
  "name": "Enterprise",
  "description": "Full feature tier",
  "featureEntitlements": ["FEATURE_A", "FEATURE_B"]
}
```
- Errors: `422 VALIDATION_FAILED`, `409 CONFLICT`.

`PATCH /api/v1/super-admin/licence-levels/:licenseLevelId`
- Auth: `SUPER_ADMIN` + step-up recommended.
- Mutable fields: `description`, `featureEntitlements`, optional display metadata.
- No delete endpoint.

### 5.2 Updated customer governance endpoints

`POST /api/v1/customers` (existing, enhanced)
- Add support for:
```json
{
  "name": "Acme",
  "website": "https://acme.example",
  "isServiceProvider": true,
  "licenseLevelId": "<ObjectId>",
  "billing": { "cycle": "MONTHLY" },
  "governance": {
    "maxTenants": 5,
    "maxVmfsPerTenant": 3
  },
  "initialAdmin": {
    "name": "Jane Admin",
    "email": "jane@acme.example"
  }
}
```
- Behavior: create must fail if valid initial customer admin is absent.

`PATCH /api/v1/customers/:customerId`
- Allow updates for `licenseLevelId`, governance limits, billing cycle, and service-provider flag.
- Each mutation audited with diff.

`PATCH /api/v1/customers/:customerId/status`
- Request accepts `ACTIVE | INACTIVE`.
- Internal mapping: `INACTIVE -> DISABLED`.
- `ARCHIVED` remains internal/admin-only legacy path and out of PRD scope.

`POST /api/v1/customers/:customerId/admins/replace` (existing, hardened)
- Enforce sole-admin safety and transactionality.
- Self-removal by sole admin forbidden unless replacement succeeds in same request.

### 5.3 New endpoint: External onboarding API

`POST /api/v1/super-admin/customers/onboard`
- Auth: `SUPER_ADMIN` (or service credential mapped to `SUPER_ADMIN` scope).
- Semantics: transactional all-or-nothing onboarding.
- Minimum request
```json
{
  "customer": {
    "companyName": "Acme",
    "website": "https://acme.example",
    "serviceProvider": true,
    "billingCycle": "MONTHLY",
    "licenseLevelId": "<ObjectId>",
    "maxTenants": 10,
    "maxVmfsPerTenant": 5
  },
  "adminUser": {
    "name": "Jane Admin",
    "email": "jane@acme.example"
  }
}
```
- Failure conditions
- Missing/invalid admin user.
- Licence level not found.
- Duplicate customer name.
- Invariant violation on admin assignment.
- Any provisioning failure.
- No partial entity persistence on failure.

### 5.4 Error model
- `VALIDATION_FAILED` for schema and invariant violations.
- `CONFLICT` for duplicate names/ids and limit exceedance.
- `FORBIDDEN` for unauthorized or lifecycle-blocked access.
- `NOT_FOUND` for unknown customer/user/licence references.

### 5.5 Versioning and compatibility
- Keep `/api/v1` version namespace.
- Preserve existing response envelope (`data`, `meta`, `error`).
- Accept legacy status values internally while standardizing governance API to `ACTIVE/INACTIVE`.

## 6. Dependency Impact

New runtime packages
- None required.

Package upgrades
- None required for this scope.

Potential optional additions (deferred)
- None; existing stack supports transactions, validation, and auditing.

Runtime and bundle impact
- Minor additional query load for governance checks.
- Mitigated through existing cache invalidation and status snapshot caches.

License compatibility
- No new third-party license obligations introduced.

## 7. Data Model and Persistence

### 7.1 New model: `LicenseLevel`

Proposed fields
- `name` (string, unique, normalized)
- `description` (string)
- `featureEntitlements` (string[])
- `isActive` (boolean, default true)
- `createdBy`, `updatedBy` (ObjectId)
- timestamps

Indexes
- Unique index on normalized `name`.
- Secondary index on `isActive`.

### 7.2 Customer model extensions

Add fields to `Customer`
- `licenseLevelId` (ObjectId ref `LicenseLevel`, required after backfill cutover)
- `governance.maxTenants` (number, min 1, default 1)
- `governance.maxVmfsPerTenant` (number, min 1, default 1)
- `governance.customerAdminUserId` (ObjectId ref `User`, required when status active)

Status mapping
- API `INACTIVE` maps to persisted `DISABLED`.

Indexes
- `licenseLevelId`
- `governance.customerAdminUserId`

### 7.3 User consistency rules
- Exactly one user with `CUSTOMER_ADMIN` role must match `customerAdminUserId` per active customer.
- Prevent disable/delete of current `customerAdminUserId` unless replacement is committed.

### 7.4 Migration and backfill strategy

Phase A (non-breaking)
- Deploy schema additions as optional.
- Create default licence level record `LEGACY_DEFAULT`.
- Backfill `licenseLevelId` for existing customers.

Phase B (governance assignment)
- Backfill `customerAdminUserId` where exactly one active `CUSTOMER_ADMIN` exists.
- Generate remediation report for customers with zero or multiple admins.

Phase C (enforcement)
- Enable strict invariant checks via feature flag.
- Make `licenseLevelId` required in validators and create flows.

Rollback strategy
- Feature-flag gate strict enforcement.
- Keep old behavior togglable while remediating data quality issues.

## 8. Security and Compliance

AuthN/AuthZ enforcement points
- Keep `authJwt`, `loadScopes`, and platform role gates.
- Add customer lifecycle enforcement in authorization middleware and login checks.
- Sensitive governance actions require `requireStepUp`.

Abuse prevention
- Reuse existing rate-limit middleware for onboarding and governance update endpoints.

Audit and compliance requirements
- Add audit actions for:
- `LICENSE_LEVEL_CREATED`
- `LICENSE_LEVEL_UPDATED`
- `CUSTOMER_LICENSE_CHANGED`
- `CUSTOMER_LIMITS_CHANGED`
- `CUSTOMER_LIFECYCLE_CHANGED`
- Ensure every event captures actor, action, target resource, and before/after values.

Secret and key handling
- No new secrets required.
- Continue existing HMAC signature and immutable audit constraints.

## 9. Implementation Plan

Phase 1 (M): Licence level domain
- Add model, validator, controller, and routes.
- Wire route in `src/app.js` under super-admin namespace.
- Add audit actions and tests.
- Touchpoints:
- `src/models/LicenseLevel.js` (new)
- `src/models/index.js`
- `src/validators/licenseLevel.validator.js` (new)
- `src/controllers/licenseLevel.controller.js` (new)
- `src/routes/licenseLevels.routes.js` (new)
- `src/services/auditService.js`
- `src/app.js`

Phase 2 (L): Customer governance invariants
- Extend `Customer` schema with licence and governance fields.
- Introduce `customerGovernanceService` for admin invariant and limit checks.
- Harden customer admin replace/update/disable flows.
- Touchpoints:
- `src/models/Customer.js`
- `src/services/customerGovernanceService.js` (new)
- `src/controllers/customer.controller.js`
- `src/controllers/user.controller.js`
- `src/validators/customer.validator.js`

Phase 3 (M): Lifecycle immediate-effect enforcement
- Add customer status enforcement to auth/login and authz middleware.
- Ensure tenant/VMF/deal scoped routes deny inactive customers.
- Touchpoints:
- `src/controllers/auth.controller.js`
- `src/middleware/authorize.js`
- `src/middleware/loadScopes.js`
- Optional new middleware: `src/middleware/customerStatus.js`

Phase 4 (L): External onboarding API (transactional)
- Add onboarding endpoint and validator.
- Implement transaction wrapper in provisioning service.
- Include idempotency and deterministic error mapping.
- Touchpoints:
- `src/routes/customers.routes.js` or new onboarding route file
- `src/controllers/customer.controller.js` or onboarding controller
- `src/validators/customer.validator.js` (onboarding schema)
- `src/services/provisioningService.js`

Phase 5 (M): Migration scripts and rollout controls
- Create backfill script(s) and dry-run report.
- Add feature flags and operational logging.
- Touchpoints:
- `src/scripts/backfillCustomerLicenseGovernance.js` (new)
- `src/config/env.js`

Phase 6 (M): Test completion
- Add targeted unit and integration suites for new invariants and endpoint contracts.
- Touchpoints:
- `src/__tests__/customerTenant.test.js`
- `src/__tests__/authorization.test.js`
- `src/__tests__/auth.routes.test.js`
- New: `src/__tests__/licenseLevels.test.js`
- New: `src/__tests__/onboarding.test.js`

## 10. Testing Plan

Unit tests
- `customerGovernanceService`
- Invariant checks: one-admin enforcement, limit checks, lifecycle mapping.
- Licence validator and controller edge cases.

Integration tests
- Create licence level, update licence level, audit generation.
- Create customer with valid admin and licence.
- Reject customer creation without valid admin.
- Enforce tenant limit on tenant create.
- Enforce VMF limit on VMF create.
- Replace admin with step-up and verify old admin removal.
- Reject sole admin self-removal/disable without replacement.
- Inactive customer blocks login and scoped resource access.

Transactional tests
- External onboarding success persists all required entities.
- External onboarding failure persists none.

Regression coverage
- Existing customer/tenant/vmf flows continue for legacy customers after backfill.
- Existing audit query APIs still function with new action types.

Edge cases
- Duplicate customer names under concurrent onboarding.
- Concurrent admin replacement attempts.
- Cache invalidation race after status changes.

## 11. Rollout and Operations

Feature flags
- `GOVERNANCE_LICENSE_LEVELS_ENABLED`
- `GOVERNANCE_STRICT_ADMIN_INVARIANT_ENABLED`
- `GOVERNANCE_INACTIVE_ENFORCEMENT_ENABLED`
- `GOVERNANCE_EXTERNAL_ONBOARDING_ENABLED`

Deployment sequence
1. Deploy schema and model changes with flags off.
2. Seed and backfill licence and governance fields.
3. Run remediation for customers violating single-admin invariant.
4. Enable inactive-enforcement flag in staging, then production.
5. Enable strict admin invariant and onboarding endpoint.

Monitoring and alerts
- Counter: blocked requests due to inactive customer.
- Counter: admin invariant violations.
- Counter: onboarding transaction failures.
- Counter: tenant and VMF limit rejection events.
- Alert on spike in `VALIDATION_FAILED` for governance endpoints.

Rollback plan
- Disable strict enforcement flags.
- Keep read paths available.
- Re-run remediation/backfill before re-enabling.

## 12. Risks and Open Questions

Risks
- Existing data may violate one-admin invariant; strict enforcement can block operations.
- Status mapping (`INACTIVE` to `DISABLED`) can confuse clients if not documented.
- Concurrency around admin replacement requires transaction discipline.

Open questions requiring product decision
- Should inactive customers be allowed limited read-only access for Super Admin tools only, or be fully blocked except explicit governance routes?
- Should customer archive (`ARCHIVED`) remain exposed in APIs or be hidden from governance UI entirely?
- Is entitlement key taxonomy centrally owned (static enum) or tenant-configurable from another system?
- Does onboarding require idempotency key support from day one?

## 13. Acceptance Criteria (Technical)

- [ ] `LicenseLevel` CRUD (create/list/get/update) exists with no delete route.
- [ ] Customer create/update requires valid `licenseLevelId` after migration cutover.
- [ ] Active customer cannot exist without exactly one valid Customer Admin reference.
- [ ] Sole Customer Admin cannot self-remove/disable/delete without successful replacement.
- [ ] Customer inactive state blocks login and all scoped tenant/VMF/deal access immediately.
- [ ] Tenant creation is rejected when `maxTenants` limit is reached.
- [ ] VMF creation is rejected when `maxVmfsPerTenant` limit is reached.
- [ ] External onboarding endpoint is transactional with zero partial writes.
- [ ] Governance validations are shared across UI-backed and API-backed flows.
- [ ] Every governance mutation emits immutable audit logs with previous and new values.
- [ ] Automated tests cover happy paths, invariant failures, concurrency-sensitive paths, and rollback behavior.
