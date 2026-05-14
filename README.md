# Repository Guidelines

## Overview
This folder contains the production-ready Node/Express API server. It defaults to port 8000 and includes hardened middleware (security headers, CORS, rate limiting, request logging) plus a health endpoint.

## Project Structure
- `src/server.js` boots the HTTP server and handles graceful shutdown.
- `src/app.js` configures Express, middleware, and routes.
- `src/routes/health.routes.js` defines `GET /health`.
- `src/middleware/` contains request logging and error handling.
- `src/config/` contains env parsing and logger configuration.

## Development Commands
Run from `VMF-v-1-api/`:
- `npm run dev` starts the server with nodemon.
- `npm run start` runs the production server.
- `npm run seed` runs baseline seeds (roles, super admin, `LEGACY_DEFAULT` licence level).
- `npm run governance:report-admin-invariants` reports active-customer admin invariant violations.
- `npm run governance:backfill` runs governance/license backfill in dry-run mode.
- `npm run governance:backfill -- --apply` applies backfill updates.

## Agent Testing Skill
- Use `vmf-api-test-coverage` from `.git/skills/vmf-api-test-coverage/SKILL.md` for comprehensive API/backend test planning, implementation, and review.
- Use it alongside `test-engineer-node` when Runtime Control work needs no-gap Jest/Supertest coverage, persistence/audit assertions, unique-index race tests, or mock/API parity fixture checks.

## Configuration
Copy `.env.example` to `.env` and adjust values as needed:
- `PORT` defaults to 8000.
- `CORS_ORIGIN` accepts a comma-separated list of allowed origins.
- `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` control throttling.
- `LOG_LEVEL` controls pino output.
- `TRUST_PROXY` should be set to `1` behind a proxy (e.g., load balancer).
- `APP_ENV` controls deployment-stage behavior (`development`, `staging`, `production`).
- `MONGODB_URI`, `JWT_SECRET`, and `JWT_REFRESH_SECRET` are required.
- Redis is optional in local dev (`REDIS_REQUIRED=false`) but recommended for full auth/session behavior.
- `FAKE_AUTH_ENABLED` only takes effect when `APP_ENV` is not `production`.
- Governance rollout flags:
  - `GOVERNANCE_LICENSE_LEVELS_ENABLED`
  - `GOVERNANCE_STRICT_ADMIN_INVARIANT_ENABLED`
  - `GOVERNANCE_INACTIVE_ENFORCEMENT_ENABLED`
  - `GOVERNANCE_EXTERNAL_ONBOARDING_ENABLED`
- `SYSTEM_ACTOR_USER_ID` can be set for deterministic seed/backfill actor attribution.

## Governance Rollout
- Dry-run invariant report: `npm run governance:report-admin-invariants`
- Dry-run backfill: `npm run governance:backfill`
- Apply backfill: `npm run governance:backfill -- --apply`
- Optional JSON output for automation: add `-- --json` to both commands.
- To fail CI/deployment checks when violations remain: `npm run governance:report-admin-invariants -- --fail-on-violations`

## Verification
- Start the server: `npm run dev`.
- Check health: `curl http://localhost:8000/health`.

## Render Deployment (Web + Redis)
This repo includes a Render Blueprint at `render.yaml` that provisions:
- Web service: `vmf-v-1-api`
- Key Value (Redis-compatible): `vmf-v-1-api-redis`

Deploy steps:
1. In Render, create a new Blueprint deployment from this repo.
2. Set required env vars when prompted:
   - `MONGODB_URI`
   - `CORS_ORIGIN`
3. Confirm `REDIS_REQUIRED=true` for production.
4. Set `APP_ENV=production` for prod deployments.
5. Deploy.

Post-deploy checks:
1. `GET /health` should return `200`.
2. `GET /health/detailed` as `SUPER_ADMIN` should include `services.redis.status = healthy`.

Notes:
- This API uses Redis for refresh token storage, token blacklisting, step-up tokens, and performance cache.
- With Redis unavailable and `REDIS_REQUIRED=false`, the API can start but auth security features degrade.
- For non-prod preview/dev environments, keep `NODE_ENV=production` and set `APP_ENV=development` (or `staging`) to allow dev-only features such as fake auth when explicitly enabled.
