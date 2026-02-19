/**
 * Auth Routes
 *
 * Mounts authentication endpoints under `/api/v1/auth`.
 *
 * Route map:
 *   POST /login               — Customer user login
 *   POST /super-admin/login   — Super Admin login
 *   POST /refresh             — Token refresh
 *   POST /logout              — Token revocation (requires auth)
 *   GET  /me                  — Authenticated user profile (requires auth)
 */

import { Router } from 'express'
import { authRateLimit, authHourlyRateLimit } from '../middleware/rateLimits.js'
import authJwt from '../middleware/authJwt.js'
import { validateLogin, validateRefresh, validateStepUp } from '../validators/auth.validator.js'
import {
  login,
  superAdminLogin,
  refresh,
  stepUp,
  logout,
  getMe,
} from '../controllers/auth.controller.js'

const router = Router()

/* ------------------------------------------------------------------ */
/*  Public (rate-limited) routes                                      */
/* ------------------------------------------------------------------ */

router.post('/login', authRateLimit, authHourlyRateLimit, validateLogin, login)
router.post('/super-admin/login', authRateLimit, authHourlyRateLimit, validateLogin, superAdminLogin)
router.post('/refresh', authRateLimit, validateRefresh, refresh)

/* ------------------------------------------------------------------ */
/*  Protected routes                                                  */
/* ------------------------------------------------------------------ */

router.post('/logout', authJwt, logout)
router.get('/me', authJwt, getMe)
router.post('/step-up', authJwt, validateStepUp, stepUp)

export default router
