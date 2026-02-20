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

## Configuration
Copy `.env.example` to `.env` and adjust values as needed:
- `PORT` defaults to 8000.
- `CORS_ORIGIN` accepts a comma-separated list of allowed origins.
- `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` control throttling.
- `LOG_LEVEL` controls pino output.
- `TRUST_PROXY` should be set to `1` behind a proxy (e.g., load balancer).
- `MONGODB_URI`, `JWT_SECRET`, and `JWT_REFRESH_SECRET` are required.
- Redis is optional in local dev (`REDIS_REQUIRED=false`) but recommended for full auth/session behavior.

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
4. Deploy.

Post-deploy checks:
1. `GET /health` should return `200`.
2. `GET /health/detailed` as `SUPER_ADMIN` should include `services.redis.status = healthy`.

Notes:
- This API uses Redis for refresh token storage, token blacklisting, step-up tokens, and performance cache.
- With Redis unavailable and `REDIS_REQUIRED=false`, the API can start but auth security features degrade.
