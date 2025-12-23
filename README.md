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

## Verification
- Start the server: `npm run dev`.
- Check health: `curl http://localhost:8000/health`.
