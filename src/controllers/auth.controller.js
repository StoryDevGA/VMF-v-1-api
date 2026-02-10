/**
 * Auth Controller
 *
 * Handles authentication endpoints:
 *   - POST /login            Customer user login
 *   - POST /super-admin/login  Super Admin login
 *   - POST /refresh          Token refresh
 *   - POST /logout           Token revocation
 *   - GET  /me               Authenticated user profile
 */

import { User } from '../models/index.js'
import tokenService from '../services/tokenService.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Shared login logic used by both customer and super-admin endpoints.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Object} opts
 * @param {string} [opts.requiredRole] - If set, the user must own this
 *   platform-level role inside `memberships`.
 */
const performLogin = async (req, res, { requiredRole } = {}) => {
  const { email, password } = req.body

  // findByEmail selects +passwordHash
  const user = await User.findByEmail(email)

  if (!user) {
    logger.warn({ email, requestId: req.requestId }, 'login failed — unknown email')
    return res.status(401).json({
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
        requestId: req.requestId,
      },
    })
  }

  // Account disabled?
  if (!user.isActive) {
    logger.warn({ userId: user._id, requestId: req.requestId }, 'login failed — account disabled')
    return res.status(401).json({
      error: {
        code: 'AUTH_ACCOUNT_DISABLED',
        message: 'Your account has been disabled. Contact your administrator.',
        requestId: req.requestId,
      },
    })
  }

  // Password check
  const passwordValid = await user.comparePassword(password)
  if (!passwordValid) {
    logger.warn({ userId: user._id, requestId: req.requestId }, 'login failed — wrong password')
    return res.status(401).json({
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
        requestId: req.requestId,
      },
    })
  }

  // Role gate (Super Admin endpoint only)
  if (requiredRole) {
    const hasPlatformRole = user.memberships.some(
      (m) => m.customerId === null && m.roles.includes(requiredRole),
    )
    if (!hasPlatformRole) {
      logger.warn(
        { userId: user._id, requiredRole, requestId: req.requestId },
        'login failed — missing required role',
      )
      return res.status(403).json({
        error: {
          code: 'AUTHZ_ROLE_REQUIRED',
          message: 'You do not have the required role to access this portal.',
          requestId: req.requestId,
        },
      })
    }
  }

  // Issue tokens
  const tokens = await tokenService.generateTokens(user)

  // Build safe user profile (passwordHash excluded via toJSON transform)
  const profile = user.toJSON()

  logger.info({ userId: user._id, requestId: req.requestId }, 'login succeeded')

  return res.status(200).json({
    data: {
      user: profile,
      ...tokens,
    },
    meta: { requestId: req.requestId, version: 'v1' },
  })
}

/* ------------------------------------------------------------------ */
/*  Controller actions                                                */
/* ------------------------------------------------------------------ */

/**
 * POST /api/v1/auth/login
 * Customer / regular user login.
 */
export const login = async (req, res, next) => {
  try {
    await performLogin(req, res)
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/auth/super-admin/login
 * Super Admin login — requires SUPER_ADMIN platform role.
 */
export const superAdminLogin = async (req, res, next) => {
  try {
    await performLogin(req, res, { requiredRole: 'SUPER_ADMIN' })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/auth/refresh
 * Exchange a valid refresh token for a new token pair.
 */
export const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body

    const tokens = await tokenService.refreshAccessToken(refreshToken)

    return res.status(200).json({
      data: tokens,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    // Specific error messages from tokenService
    if (
      err.message.includes('Invalid') ||
      err.message.includes('expired') ||
      err.message.includes('not found') ||
      err.message.includes('inactive')
    ) {
      return res.status(401).json({
        error: {
          code: 'AUTH_REFRESH_FAILED',
          message: 'Unable to refresh session. Please sign in again.',
          requestId: req.requestId,
        },
      })
    }
    next(err)
  }
}

/**
 * POST /api/v1/auth/logout
 * Blacklist the current access token and revoke the refresh token.
 */
export const logout = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    const accessToken = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null

    // Blacklist the current access token (if provided)
    if (accessToken) {
      await tokenService.blacklistToken(accessToken)
    }

    // Revoke the refresh token for this user
    if (req.context?.userId) {
      await tokenService.revokeRefreshToken(req.context.userId)
    }

    logger.info({ userId: req.context?.userId, requestId: req.requestId }, 'logout')

    return res.status(200).json({
      data: { message: 'Logged out successfully.' },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/auth/me
 * Return the authenticated user's profile, roles, and memberships.
 */
export const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.context.userId)

    if (!user || !user.isActive) {
      return res.status(401).json({
        error: {
          code: 'AUTH_TOKEN_INVALID',
          message: 'Your session is invalid. Please sign in again.',
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: { user: user.toJSON() },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
