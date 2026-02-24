/**
 * Fake Auth Controller (dev/testing only)
 *
 * Simulates Identity Plus verification for the super admin invitation flow.
 * Mirrors the logic from identityPlus.controller.js handleRegistrationComplete.
 *
 * Feature-gated behind env.fakeAuthAllowed — never available in production.
 */

import crypto from 'node:crypto'
import { Invitation, User } from '../models/index.js'
import logger from '../config/logger.js'
import auditService from '../services/auditService.js'
import performanceCacheService from '../services/performanceCacheService.js'

export const getFakeAuthInvitation = async (req, res, next) => {
  try {
    const invitation = await Invitation.findById(req.params.invitationId)
    if (!invitation) {
      return res.status(404).json({
        error: {
          code: 'INVITATION_NOT_FOUND',
          message: 'Invitation not found.',
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: {
        id: invitation._id,
        recipientEmail: invitation.recipientEmail,
        recipientName: invitation.recipientName,
        companyName: invitation.company?.name ?? null,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const completeFakeAuth = async (req, res, next) => {
  try {
    const invitation = await Invitation.findById(req.params.invitationId)
    if (!invitation) {
      return res.status(404).json({
        error: {
          code: 'INVITATION_NOT_FOUND',
          message: 'Invitation not found.',
          requestId: req.requestId,
        },
      })
    }

    if (invitation.status !== 'accessed') {
      return res.status(409).json({
        error: {
          code: 'INVITATION_WRONG_STATE',
          message: `Invitation is in "${invitation.status}" state. Expected "accessed".`,
          requestId: req.requestId,
        },
      })
    }

    if (invitation.isExpired()) {
      return res.status(409).json({
        error: {
          code: 'INVITATION_EXPIRED',
          message: 'This invitation has expired.',
          requestId: req.requestId,
        },
      })
    }

    const user = await User.findOne({ email: invitation.recipientEmail })
    if (!user) {
      logger.warn(
        { email: invitation.recipientEmail, invitationId: invitation._id, requestId: req.requestId },
        'fake auth — expected pre-provisioned user not found',
      )
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: `No user account found for ${invitation.recipientEmail}. Auto-provisioning may have failed. Please revoke and re-create the invitation.`,
          requestId: req.requestId,
        },
      })
    }

    // Idempotency: already trusted — mirrors real webhook behavior
    if (user.identityPlus.trustStatus === 'TRUSTED') {
      logger.info(
        { userId: user._id, email: user.email, requestId: req.requestId },
        'fake auth — user already trusted, no-op',
      )
      return res.status(200).json({
        data: { acknowledged: true, action: 'no_change' },
        meta: { requestId: req.requestId, version: 'v1' },
      })
    }

    const fakeExternalId = `fake_${crypto.randomUUID()}`
    const now = new Date()

    // Update User trust status
    const previousTrustStatus = user.identityPlus.trustStatus
    user.identityPlus.externalId = fakeExternalId
    user.identityPlus.trustStatus = 'TRUSTED'
    user.identityPlus.trustedAt = now
    await user.save()
    await performanceCacheService.invalidateUserPermissions(user._id)

    // Update Invitation status
    invitation.status = 'authenticated'
    invitation.authenticatedAt = now
    invitation.identityPlusSubjectId = fakeExternalId
    await invitation.save()

    // Audit: invitation authenticated
    await auditService.logFromRequest(req, {
      actorUserId: user._id,
      action: auditService.AUDIT_ACTIONS.INVITATION_AUTHENTICATION_SUCCEEDED,
      resourceType: auditService.RESOURCE_TYPES.Invitation,
      resourceId: invitation._id,
      scope: {},
      diff: {
        status: { from: 'accessed', to: 'authenticated' },
        identityPlusSubjectId: fakeExternalId,
        fakeAuth: true,
      },
    })

    // Audit: user trust updated
    await auditService.logFromRequest(req, {
      actorUserId: user._id,
      action: auditService.AUDIT_ACTIONS.IDENTITY_PLUS_REGISTRATION_COMPLETE,
      resourceType: auditService.RESOURCE_TYPES.User,
      resourceId: user._id,
      scope: {},
      diff: {
        trustStatus: { from: previousTrustStatus, to: 'TRUSTED' },
        externalId: { from: null, to: fakeExternalId },
        fakeAuth: true,
      },
    })

    logger.info(
      { userId: user._id, email: user.email, fakeExternalId, requestId: req.requestId },
      'fake auth — user trusted via fake verification',
    )

    return res.status(200).json({
      data: {
        acknowledged: true,
        action: 'trusted',
        userId: user._id,
        invitationId: invitation._id,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
