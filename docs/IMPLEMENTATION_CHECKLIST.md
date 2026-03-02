# VMF-v-1-api Implementation Checklist (vs STORYLINEOS_BACKEND_BUILD_GUIDE)

Tracking status against `VMF-v-1-api/docs/STORYLINEOS_BACKEND_BUILD_GUIDE.md`.

## Architecture Summary
- [ ] Clerk authentication + session/JWT verification
- [ ] DB-controlled membership/roles/permissions
- [ ] Hierarchy modeled: Platform -> Customer -> Tenant -> VMF -> Deal
- [ ] Default Tenant created for each Customer

## Local Setup
- [x] Node 18+ baseline
- [x] MongoDB connection via Mongoose
- [ ] `.env.example` provided
- [ ] `CLERK_SECRET_KEY` support
- [x] `MONGODB_URI` support
- [x] `CORS_ORIGIN` support

## MongoDB Data Model (Mongoose)
- [ ] User
- [ ] Customer
- [ ] Tenant
- [ ] CustomerUser (membership)
- [ ] TenantUser (membership)
- [ ] CustomerUserRole (roles per customer)
- [ ] Role (global role definitions)
- [ ] VMF
- [ ] Deal
- [ ] VMFAccess (ACL)
- [ ] DealAccess (ACL)
- [ ] AuditLog

## Clerk Integration (Backend-Controlled)
- [ ] Verify Clerk token with `@clerk/backend`
- [ ] `ensureUser` middleware
- [ ] Support invite-first, signup-later link by email

## Context Resolution (Customer/Tenant)
- [ ] `resolveContext` middleware
- [ ] Attach `req.ctx = { customer, tenant, roles }`

## Authorization
- [ ] RBAC guards (`requireSuperAdmin`, `requireCustomerAdmin`)
- [ ] ACL helpers for VMF/Deal access

## Route Map
### Public
- [x] `GET /health`

### Authenticated
- [ ] `GET /me`

### Platform (Super Admin)
- [ ] `POST /platform/customers`
- [ ] `GET /platform/customers`
- [ ] `GET /platform/customers/:customerId`
- [ ] `PATCH /platform/customers/:customerId`

### Customer Admin
- [ ] `POST /customers/:customerId/admin/tenants`
- [ ] `GET /customers/:customerId/admin/tenants`
- [ ] `POST /customers/:customerId/admin/users/invite`

### Tenant-scoped business
- [ ] `POST /customers/:customerId/tenants/:tenantId/vmfs`
- [ ] `GET /customers/:customerId/tenants/:tenantId/vmfs`
- [ ] `GET /customers/:customerId/tenants/:tenantId/vmfs/:vmfId`
- [ ] `PATCH /customers/:customerId/tenants/:tenantId/vmfs/:vmfId`
- [ ] `POST /customers/:customerId/tenants/:tenantId/vmfs/:vmfId/deals`
- [ ] `GET /customers/:customerId/tenants/:tenantId/deals/:dealId`
- [ ] `PATCH /customers/:customerId/tenants/:tenantId/deals/:dealId`

## Code Skeleton (File Structure)
- [x] `src/server.js`
- [x] `src/app.js`
- [x] `src/config/env.js`
- [x] `src/config/logger.js`
- [x] `src/config/db.js` (in place of `db/connect.js`)
- [ ] `src/middleware/clerkAuth.js`
- [ ] `src/middleware/ensureUser.js`
- [ ] `src/middleware/resolveContext.js`
- [ ] `src/authz/guards.js`
- [ ] `src/authz/acl.js`
- [ ] `src/models/*` (all models listed above)
- [ ] `src/controllers/*` (platform, customer admin, vmfs, deals)
- [x] `src/routes/health.routes.js`
- [ ] `src/routes/me.routes.js`
- [ ] `src/routes/platform.routes.js`
- [ ] `src/routes/customerAdmin.routes.js`
- [ ] `src/routes/tenantBusiness.routes.js`

## Notes / Next Enhancements
- [ ] CustomerUserRole and TenantUser management endpoints
- [ ] ACL management endpoints
- [ ] Strict query scoping (`customerId + tenantId`)
- [ ] `X-Request-Id` and audit more actions
- [ ] Test harness (Jest + supertest or Vitest + supertest)

## Governance Rollout and Hardening (PR1-PR8)

### Release Readiness Gates
- [ ] `npm run test -- src/__tests__/licenseLevels.test.js src/__tests__/customerTenant.test.js src/__tests__/customerGovernanceService.test.js src/__tests__/onboarding.test.js src/__tests__/authorization.test.js src/__tests__/auth.routes.test.js src/__tests__/healthMonitoring.test.js src/__tests__/performanceOptimization.test.js`
- [ ] `npm run governance:report-admin-invariants -- --json` reviewed and remediation plan approved.
- [ ] `npm run governance:backfill -- --json` dry-run output archived.
- [ ] `npm run governance:backfill -- --apply` executed in staging and validated.
- [ ] Governance flags staged in rollout order (inactive enforcement, strict admin invariant, external onboarding).

### Operational Metrics to Validate
- [ ] `${METRICS_PREFIX}governance_inactive_customer_blocks_total`
- [ ] `${METRICS_PREFIX}governance_limit_rejections_total`
- [ ] `${METRICS_PREFIX}governance_onboarding_transaction_failures_total`
- [ ] Alert thresholds reviewed on `/health/detailed` and `/health/alerts`.

### Production Rollout Sequence
1. Deploy with governance flags enabled only for non-disruptive paths.
2. Run invariant report and resolve active-customer admin violations.
3. Run backfill apply; verify no unresolved violations remain.
4. Enable `GOVERNANCE_INACTIVE_ENFORCEMENT_ENABLED`.
5. Enable `GOVERNANCE_STRICT_ADMIN_INVARIANT_ENABLED`.
6. Enable `GOVERNANCE_EXTERNAL_ONBOARDING_ENABLED`.
7. Monitor governance counters and audit stream for 24 hours.

### Rollback Sequence
1. Set `GOVERNANCE_EXTERNAL_ONBOARDING_ENABLED=false`.
2. Set `GOVERNANCE_STRICT_ADMIN_INVARIANT_ENABLED=false`.
3. Set `GOVERNANCE_INACTIVE_ENFORCEMENT_ENABLED=false` only if access-impact incident persists.
4. Re-run `npm run governance:report-admin-invariants -- --json` and document remediation actions.
5. Re-enable flags progressively after root-cause fix and staging verification.
