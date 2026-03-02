# Implementation Plan: Super Admin Licence and Customer Governance

Source spec
- `tasks/tech-spec-super-admin-licence-customer-governance-vfinal.md`

Source PRD
- `C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/PRD/prd-super-admin-licence-customer-governance-vFinal.md`

## 1. Delivery Strategy

Delivery model
- Ship this feature in small, reversible PRs.
- Keep strict governance enforcement behind feature flags until data backfill and remediation finish.
- Add test coverage in every PR, not only at the end.

Target PR sequence

| PR | Title | Size | Dependency |
|---|---|---|---|
| 1 | Licence Level Domain and API | M | None |
| 2 | Customer Governance Schema and Validation | M | PR 1 |
| 3 | Customer Admin Invariant Enforcement | L | PR 2 |
| 4 | Inactive Customer Access Enforcement | M | PR 3 |
| 5 | Tenant and VMF Limit Enforcement | M | PR 2 |
| 6 | Transactional External Onboarding API | L | PR 1-5 |
| 7 | Backfill, Feature Flags, and Operational Rollout Controls | M | PR 1-6 |
| 8 | Final Hardening, Monitoring, and Regression Sweep | M | PR 1-7 |

## 2. Branching and PR Conventions

Branch naming
- `feature/super-admin-license-governance-pr1-license-levels`
- `feature/super-admin-license-governance-pr2-customer-schema`
- Continue same pattern for PR3 to PR8.

PR template requirements
- Summary and scope boundary.
- API contract changes.
- Data migration impact.
- Feature flags touched.
- Test evidence and exact command output summary.
- Rollback notes.

## 3. PR-by-PR Execution Plan

## PR 1: Licence Level Domain and API

Objective
- Introduce first-class licence levels with auditable create and update flows.

Files to add
- `src/models/LicenseLevel.js`
- `src/validators/licenseLevel.validator.js`
- `src/controllers/licenseLevel.controller.js`
- `src/routes/licenseLevels.routes.js`
- `src/__tests__/licenseLevels.test.js`

Files to update
- `src/models/index.js`
- `src/services/auditService.js`
- `src/app.js`

Implementation tasks
- Define `LicenseLevel` schema with normalized unique name and entitlement list.
- Add list, create, get-by-id, update endpoints for `SUPER_ADMIN`.
- Register new audit actions for licence lifecycle.
- Keep delete operation unsupported.

API endpoints in this PR
- `GET /api/v1/super-admin/licence-levels`
- `POST /api/v1/super-admin/licence-levels`
- `PATCH /api/v1/super-admin/licence-levels/:licenseLevelId`

Tests in this PR
- Validator coverage for required fields and entitlement keys.
- Create/update success and conflict paths.
- Unauthorized and missing role guards.
- Audit event assertions for create/update.

Exit criteria
- Licence level endpoints work and are audited.
- No regression in existing auth and audit tests.

## PR 2: Customer Governance Schema and Validation

Objective
- Extend `Customer` with licence and governance fields without turning on strict enforcement yet.

Files to update
- `src/models/Customer.js`
- `src/validators/customer.validator.js`
- `src/controllers/customer.controller.js`
- `src/services/performanceCacheService.js`
- `src/__tests__/customerTenant.test.js`

Files to add
- `src/validators/governance.shared.validator.js` (optional helper for shared governance shape)

Implementation tasks
- Add fields:
- `licenseLevelId`
- `governance.maxTenants`
- `governance.maxVmfsPerTenant`
- `governance.customerAdminUserId`
- Update create and patch validators to accept governance fields.
- Add API status compatibility mapping `INACTIVE -> DISABLED` in controller boundary.
- Audit diffs when licence and governance values change.

Tests in this PR
- Customer create and patch accept governance payload.
- Invalid licence or invalid limit values fail with `422`.
- Status mapping behavior verified.

Exit criteria
- New schema and payload fields are persisted and returned safely.
- Existing customer endpoints remain backward compatible.

## PR 3: Customer Admin Invariant Enforcement

Objective
- Enforce exactly one active Customer Admin for each active customer.

Files to add
- `src/services/customerGovernanceService.js`
- `src/__tests__/customerGovernanceService.test.js`

Files to update
- `src/controllers/customer.controller.js`
- `src/controllers/user.controller.js`
- `src/validators/customer.validator.js`
- `src/services/auditService.js`
- `src/__tests__/customerTenant.test.js`
- `src/__tests__/userManagement.test.js`

Implementation tasks
- Centralize invariants in service:
- validate active customer has exactly one admin.
- validate replacement transaction rules.
- block sole admin self-removal/disable/delete unless replacement completes atomically.
- Harden `POST /api/v1/customers/:customerId/admins/replace`.
- Ensure `governance.customerAdminUserId` is the canonical pointer.
- Add governance-specific audit actions and diffs.

Tests in this PR
- Replacement happy path.
- Replacement failure rollback path.
- Sole admin cannot self-remove.
- Disable/delete of canonical admin blocked without replacement.

Exit criteria
- Invariant holds across customer and user mutation endpoints.
- Tests prove no orphan-active-customer condition can be created.

## PR 4: Inactive Customer Access Enforcement

Objective
- Make customer inactive state take immediate effect platform-wide.

Files to add
- `src/middleware/customerStatus.js` (if separated from authorize logic)
- `src/__tests__/customerStatusEnforcement.test.js`

Files to update
- `src/middleware/authorize.js`
- `src/middleware/loadScopes.js`
- `src/controllers/auth.controller.js`
- `src/routes/tenants.routes.js`
- `src/routes/vmfs.routes.js`
- `src/routes/deals.routes.js`
- `src/routes/users.routes.js`
- `src/__tests__/authorization.test.js`
- `src/__tests__/auth.routes.test.js`

Implementation tasks
- Reject access when customer scope status is inactive.
- Enforce at authz layer so UI and API inherit same rule.
- Add login guard for users under inactive customers.
- Keep explicit SUPER_ADMIN governance routes operational for reactivation.

Tests in this PR
- Inactive customer users cannot login.
- Scoped customer/tenant/vmf/deal routes return forbidden consistently.
- Reactivation restores normal access.

Exit criteria
- Inactive state supersedes lower-level states in runtime behavior.

## PR 5: Tenant and VMF Limit Enforcement

Objective
- Enforce customer-configured tenant and per-tenant VMF limits.

Files to update
- `src/controllers/tenant.controller.js`
- `src/controllers/vmf.controller.js`
- `src/middleware/topologyGuard.js`
- `src/services/customerGovernanceService.js`
- `src/services/auditService.js`
- `src/__tests__/customerTenant.test.js`

Implementation tasks
- Before tenant create, enforce `governance.maxTenants`.
- Before VMF create, enforce `governance.maxVmfsPerTenant`.
- Return deterministic `409 CONFLICT` on limit exceed.
- Audit limit-rejection and limit-change events.

Tests in this PR
- Tenant creation fails at boundary plus one.
- VMF creation fails at boundary plus one.
- Updates to limits apply immediately.

Exit criteria
- Limits are enforced in both controller and guard paths.

## PR 6: Transactional External Onboarding API

Objective
- Add all-or-nothing external onboarding endpoint with mandatory valid Customer Admin.

Files to add
- `src/validators/onboarding.validator.js`
- `src/controllers/onboarding.controller.js` (or add action to `customer.controller.js`)
- `src/routes/onboarding.routes.js` (or mount under customers routes)
- `src/__tests__/onboarding.test.js`

Files to update
- `src/services/provisioningService.js`
- `src/app.js`
- `src/services/auditService.js`

Implementation tasks
- Implement Mongoose session transaction for:
- customer creation
- admin user create or attach
- membership assignment
- canonical `customerAdminUserId` set
- provisioning defaults
- Ensure any failure causes full rollback.
- Validate admin input first and reject partial requests early.
- Keep governance parity with existing UI-backed customer flows.

Tests in this PR
- Success path creates all required entities.
- Missing/invalid admin path persists nothing.
- Duplicate customer path persists nothing.
- Simulated mid-transaction failure persists nothing.

Exit criteria
- Onboarding endpoint is atomic and auditable end-to-end.

## PR 7: Backfill and Rollout Controls

Objective
- Prepare existing data and configuration for strict governance rollout.

Files to add
- `src/scripts/backfillCustomerLicenseGovernance.js`
- `src/scripts/reportCustomerAdminInvariantViolations.js`
- `src/seeds/licenseLevels.js`

Files to update
- `src/config/env.js`
- `src/seeds/index.js`
- `.env.example`
- `README.md`

Implementation tasks
- Add flags:
- `GOVERNANCE_LICENSE_LEVELS_ENABLED`
- `GOVERNANCE_STRICT_ADMIN_INVARIANT_ENABLED`
- `GOVERNANCE_INACTIVE_ENFORCEMENT_ENABLED`
- `GOVERNANCE_EXTERNAL_ONBOARDING_ENABLED`
- Seed default legacy licence level.
- Backfill existing customers with `licenseLevelId`.
- Detect and report admin invariant violations for remediation.

Tests in this PR
- Script dry-run outputs expected counts.
- Script apply mode updates expected docs.
- Env flag parsing is covered.

Exit criteria
- Production data can be safely switched to strict enforcement.

## PR 8: Final Hardening and Regression Sweep

Objective
- Close operational gaps and prove readiness for release.

Files to update
- `src/services/monitoringService.js` (if counters exist here)
- `src/services/auditService.js`
- `src/__tests__/performanceOptimization.test.js`
- `src/__tests__/authorization.test.js`
- `docs/IMPLEMENTATION_CHECKLIST.md`

Implementation tasks
- Add counters for:
- inactive-customer blocks
- limit-rejection events
- onboarding transaction failures
- Add final regression and concurrency-focused tests.
- Update internal checklist docs with release and rollback steps.

Tests in this PR
- Full targeted suite for touched areas.
- Final pass on customer/tenant/user/audit/auth suites.

Exit criteria
- Acceptance criteria from the technical spec are satisfied.
- Monitoring and rollback runbook are complete.

## 4. Test Execution Matrix by PR

PR 1
- `npm test -- src/__tests__/licenseLevels.test.js`

PR 2
- `npm test -- src/__tests__/customerTenant.test.js`

PR 3
- `npm test -- src/__tests__/customerTenant.test.js src/__tests__/userManagement.test.js src/__tests__/customerGovernanceService.test.js`

PR 4
- `npm test -- src/__tests__/authorization.test.js src/__tests__/auth.routes.test.js src/__tests__/customerStatusEnforcement.test.js`

PR 5
- `npm test -- src/__tests__/customerTenant.test.js`

PR 6
- `npm test -- src/__tests__/onboarding.test.js src/__tests__/customerTenant.test.js`

PR 7
- `npm test -- src/__tests__/customerTenant.test.js src/__tests__/authorization.test.js`

PR 8
- `npm test`

## 5. Merge Gates

Required before merging each PR
- CI test pass for touched area.
- No unresolved open security comments.
- Audit events verified for all new write paths.
- Backward compatibility confirmed for existing API contracts unless explicitly versioned.

## 6. Release Sequence

Staging release
1. Deploy PR1 to PR6 with strict flags off.
2. Run PR7 scripts in dry-run.
3. Remediate invariant violations.
4. Run apply-mode backfill.
5. Enable inactive enforcement.
6. Enable strict admin invariant.
7. Enable external onboarding.

Production release
1. Repeat staging order.
2. Enable flags progressively with monitoring.
3. Keep rollback path as flag disable plus script rollback where required.
