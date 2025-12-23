# StoryLineOS Backend Build Guide (MERN + Clerk Identity + DB-Controlled Membership)

This document includes:
1. Architecture & boundaries (Clerk vs DB)
2. Data model (Mongo/Mongoose)
3. Middleware (auth + context)
4. RBAC + ACL authorization approach
5. Route map and code skeleton (file-by-file)
6. Setup instructions (run locally)

---

## 1) Architecture Summary

### Responsibility split
- **Clerk**: authentication (identity/session/JWT verification)
- **Backend + DB**: customer/tenant memberships, roles, permissions, admin authority, auditing

### Hierarchy
`Platform → Customer → Tenant → VMF → Deal`

### Core goals
- Super Admin (StoryLineOS employee) can CRUD customers and maintain roles.
- Customer Admin can create tenants, invite users, assign roles, assign tenant membership.
- Users can have **multiple roles** per customer.
- Users can have **explicit ACLs** for VMFs and Deals (`read` / `write`).
- **Single-tenant customers still have a Default Tenant**, enabling later upgrade with no refactor.

---

## 2) Local Setup

### 2.1 Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)

### 2.2 Install and run
```bash
cd storylineos-backend-skeleton
cp .env.example .env
npm install
npm run dev
```

### 2.3 Required env vars
- `MONGODB_URI`
- `CLERK_SECRET_KEY`
- `CORS_ORIGIN` (recommended)

---

## 3) MongoDB Data Model

### 3.1 Collections
- `User`
- `Customer`
- `Tenant`
- `CustomerUser` (membership)
- `TenantUser` (membership)
- `CustomerUserRole` (roles per customer)
- `Role` (global role definitions; optional but recommended)
- `VMF`
- `Deal`
- `VMFAccess` (ACL)
- `DealAccess` (ACL)
- `AuditLog`

### 3.2 Single-tenant logic
Every Customer gets a Default Tenant on creation:
- prevents conditional logic
- supports upgrade to multi-tenant later

---

## 4) Clerk Integration (Backend-Controlled)

### 4.1 Token verification
Every request:
1) Frontend sends `Authorization: Bearer <ClerkToken>`
2) Backend verifies token with `@clerk/backend`
3) Backend uses `sub` as `clerkUserId`

### 4.2 ensureUser middleware
- Finds or creates `User` in DB
- Supports “invite first, signup later” by linking user by email when `clerkUserId` becomes known

---

## 5) Context Resolution (Customer/Tenant)

`resolveContext` middleware loads:
- customer (and checks active)
- membership in customer
- roles for customer
- tenant and membership in tenant (if tenant route)

Attaches:
- `req.ctx = { customer, tenant, roles }`

---

## 6) Authorization

### 6.1 RBAC
- `requireSuperAdmin` → platform endpoints
- `requireCustomerAdmin` → customer admin endpoints

### 6.2 ACL
- `VMFAccess`: (vmfId, userId) → read/write
- `DealAccess`: (dealId, userId) → read/write

Customer Admin can be treated as bypass within customer (optional; current skeleton assumes admin for creation, and admin sees all VMFs).

---

## 7) Route Map

### Public
- `GET /health`

### Authenticated
- `GET /me`

### Platform (Super Admin)
- `POST /platform/customers` (creates Customer + Default Tenant)
- `GET /platform/customers`
- `GET /platform/customers/:customerId`
- `PATCH /platform/customers/:customerId`

### Customer Admin
- `POST /customers/:customerId/admin/tenants`
- `GET /customers/:customerId/admin/tenants`
- `POST /customers/:customerId/admin/users/invite` (DB membership + Clerk invite)

### Tenant-scoped business
- `POST /customers/:customerId/tenants/:tenantId/vmfs`
- `GET /customers/:customerId/tenants/:tenantId/vmfs`
- `GET /customers/:customerId/tenants/:tenantId/vmfs/:vmfId`
- `PATCH /customers/:customerId/tenants/:tenantId/vmfs/:vmfId`
- `POST /customers/:customerId/tenants/:tenantId/vmfs/:vmfId/deals`
- `GET /customers/:customerId/tenants/:tenantId/deals/:dealId`
- `PATCH /customers/:customerId/tenants/:tenantId/deals/:dealId`

---

## 8) Code Skeleton (Generated)

The repository skeleton has been generated under:
`storylineos-backend-skeleton/`

### 8.1 Structure
```
storylineos-backend-skeleton/
  package.json
  .env.example
  src/
    server.js
    app.js
    config/
      env.js
      logger.js
    db/
      connect.js
    middleware/
      clerkAuth.js
      ensureUser.js
      resolveContext.js
    authz/
      guards.js
      acl.js
    models/
      User.js
      Customer.js
      Tenant.js
      CustomerUser.js
      TenantUser.js
      CustomerUserRole.js
      Role.js
      VMF.js
      Deal.js
      VMFAccess.js
      DealAccess.js
      AuditLog.js
    controllers/
      platformCustomers.controller.js
      customerAdmin.controller.js
      vmfs.controller.js
      deals.controller.js
    routes/
      health.routes.js
      me.routes.js
      platform.routes.js
      customerAdmin.routes.js
      tenantBusiness.routes.js
```

---

## 9) Notes / Next Enhancements

Recommended next increments:
1) Add endpoints to manage `CustomerUserRole` and `TenantUser` directly (admin-only)
2) Add ACL management endpoints:
   - grant/revoke VMF/Deal access
3) Add strict query scoping patterns across all reads (`customerId + tenantId`)
4) Add a consistent `X-Request-Id` and audit more actions
5) Add test harness (Jest + supertest)

---

## 10) Files Included (Reference)

This doc is paired with the generated backend skeleton code. Download both and begin implementation.

