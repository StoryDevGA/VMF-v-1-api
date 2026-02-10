/**
 * Identity Plus Webhook Controller
 *
 * Handles incoming webhooks from the Identity Plus provider:
 *   - POST /registration-complete  — user completed registration
 *   - POST /trust-updated          — trust status changed externally
 *
 * Both endpoints update the User document and create an audit log.
 */

import { User, AuditLog } from '../models/index.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  POST /registration-complete                                       */
/* ------------------------------------------------------------------ */

/**
 * Handle the registration-complete webhook.
 *
 * When Identity Plus confirms a user has finished sign-up / identity
 * verification, we transition their `identityPlus.trustStatus` from
 * UNTRUSTED → TRUSTED and record the `externalId`.
 */
export const handleRegistrationComplete = async (req, res, next) => {
  try {
    const { externalId, email, registeredAt } = req.body

    const user = await User.findOne({ email })

    if (!user) {
      logger.warn(
        { email, externalId, requestId: req.requestId },
        'registration-complete webhook — user not found',
      )
      // Return 200 to prevent retries for unknown users
      return res.status(200).json({
        data: { acknowledged: true, action: 'ignored', reason: 'user_not_found' },
        meta: { requestId: req.requestId, version: 'v1' },
      })
    }

    // Already trusted or revoked — idempotent, no change
    if (user.identityPlus.trustStatus === 'TRUSTED') {
      logger.info(
        { userId: user._id, email, requestId: req.requestId },
        'registration-complete webhook — already trusted, no-op',
      )
      return res.status(200).json({
        data: { acknowledged: true, action: 'no_change' },
        meta: { requestId: req.requestId, version: 'v1' },
      })
    }

    // Update trust state
    const previousStatus = user.identityPlus.trustStatus
    user.identityPlus.externalId = externalId
    user.identityPlus.trustStatus = 'TRUSTED'
    user.identityPlus.trustedAt = registeredAt ? new Date(registeredAt) : new Date()
    await user.save()

    // Audit log
    try {
      await AuditLog.createLog({
        actorUserId: user._id, // self-action via webhook
        action: 'IDENTITY_PLUS_REGISTRATION_COMPLETE',
        resourceType: 'User',
        resourceId: user._id,
        scope: {},
        diff: {
          trustStatus: { from: previousStatus, to: 'TRUSTED' },
          externalId: { from: null, to: externalId },
        },
        ip: req.ip,
        userAgent: req.get('user-agent'),
        requestId: req.requestId,
      })
    } catch (auditErr) {
      // Audit failure must not block the webhook response
      logger.error({ err: auditErr, requestId: req.requestId }, 'audit log failed')
    }

    logger.info(
      { userId: user._id, email, externalId, requestId: req.requestId },
      'registration-complete webhook — user trusted',
    )

    return res.status(200).json({
      data: { acknowledged: true, action: 'trusted', userId: user._id },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /trust-updated                                               */
/* ------------------------------------------------------------------ */

/**
 * Handle the trust-updated webhook.
 *
 * Fired when the trust status changes in Identity Plus externally
 * (e.g. admin revokes trust from the provider dashboard).
 * Supported transitions: TRUSTED→REVOKED, REVOKED→TRUSTED.
 */
export const handleTrustUpdated = async (req, res, next) => {
  try {
    const { externalId, email, trustStatus, updatedAt } = req.body

    // Look up user by externalId first, fallback to email
    let user = null
    if (externalId) {
      user = await User.findOne({ 'identityPlus.externalId': externalId })
    }
    if (!user && email) {
      user = await User.findOne({ email })
    }

    if (!user) {
      logger.warn(
        { externalId, email, requestId: req.requestId },
        'trust-updated webhook — user not found',
      )
      return res.status(200).json({
        data: { acknowledged: true, action: 'ignored', reason: 'user_not_found' },
        meta: { requestId: req.requestId, version: 'v1' },
      })
    }

    // Already in the target state — idempotent
    if (user.identityPlus.trustStatus === trustStatus) {
      logger.info(
        { userId: user._id, trustStatus, requestId: req.requestId },
        'trust-updated webhook — already in target state, no-op',
      )
      return res.status(200).json({
        data: { acknowledged: true, action: 'no_change' },
        meta: { requestId: req.requestId, version: 'v1' },
      })
    }

    const previousStatus = user.identityPlus.trustStatus

    // Apply trust status change
    user.identityPlus.trustStatus = trustStatus
    if (trustStatus === 'TRUSTED') {
      user.identityPlus.trustedAt = updatedAt ? new Date(updatedAt) : new Date()
    }
    if (trustStatus === 'REVOKED') {
      // Disable the user account when trust is revoked externally
      user.isActive = false
    }
    await user.save()

    // Audit log
    try {
      await AuditLog.createLog({
        actorUserId: user._id, // external action attributed to user
        action: 'IDENTITY_PLUS_TRUST_UPDATED',
        resourceType: 'User',
        resourceId: user._id,
        scope: {},
        diff: {
          trustStatus: { from: previousStatus, to: trustStatus },
          ...(trustStatus === 'REVOKED' ? { isActive: { from: true, to: false } } : {}),
        },
        ip: req.ip,
        userAgent: req.get('user-agent'),
        requestId: req.requestId,
      })
    } catch (auditErr) {
      logger.error({ err: auditErr, requestId: req.requestId }, 'audit log failed')
    }

    logger.info(
      { userId: user._id, from: previousStatus, to: trustStatus, requestId: req.requestId },
      'trust-updated webhook — status changed',
    )

    return res.status(200).json({
      data: { acknowledged: true, action: 'updated', userId: user._id },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
