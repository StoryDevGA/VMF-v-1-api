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

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const getFirstCustomerMembershipId = (user) => {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : []
  const membershipWithCustomer = memberships.find((membership) => membership?.customerId)
  return membershipWithCustomer?.customerId || null
}

const ensureCustomerAdminMembership = (user, customerId) => {
  if (!customerId) return false

  if (!Array.isArray(user.memberships)) {
    user.memberships = []
  }

  const targetCustomerId = toIdString(customerId)
  const membership = user.memberships.find(
    (entry) => toIdString(entry?.customerId) === targetCustomerId,
  )

  if (!membership) {
    user.memberships.push({ customerId, roles: ['CUSTOMER_ADMIN'] })
    return true
  }

  if (!Array.isArray(membership.roles)) {
    membership.roles = []
  }

  if (!membership.roles.includes('CUSTOMER_ADMIN')) {
    membership.roles.push('CUSTOMER_ADMIN')
    return true
  }

  return false
}

const provisionUserFromInvitation = async ({ invitation, normalizedEmail, req }) => {
  if (!invitation.provisionedCustomerId) {
    return null
  }

  const nameFallback = normalizedEmail.split('@')[0] || 'Invited User'
  let user = new User({
    email: normalizedEmail,
    name: invitation.recipientName || nameFallback,
    isActive: true,
    identityPlus: { trustStatus: 'UNTRUSTED' },
    memberships: [{ customerId: invitation.provisionedCustomerId, roles: ['CUSTOMER_ADMIN'] }],
  })

  let created = false
  try {
    await user.save()
    created = true
  } catch (saveErr) {
    if (saveErr?.code !== 11000) {
      throw saveErr
    }

    logger.info(
      { email: normalizedEmail, invitationId: invitation._id, requestId: req.requestId },
      'fake auth - user created concurrently, using existing account',
    )
    user = await User.findOne({ email: normalizedEmail })
    if (!user) {
      throw saveErr
    }
  }

  if (created) {
    await auditService.logFromRequest(req, {
      actorUserId: invitation.createdBy || user._id,
      action: auditService.AUDIT_ACTIONS.USER_CREATED,
      resourceType: auditService.RESOURCE_TYPES.User,
      resourceId: user._id,
      scope: { customerId: invitation.provisionedCustomerId },
      diff: {
        autoProvisioned: true,
        fakeAuth: true,
        source: 'fake_auth_completion',
      },
    })

    logger.info(
      {
        userId: user._id,
        email: normalizedEmail,
        customerId: invitation.provisionedCustomerId,
        invitationId: invitation._id,
        requestId: req.requestId,
      },
      'fake auth - auto-provisioned missing invitation user',
    )
  }

  return user
}

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

    const normalizedRecipientEmail = normalizeEmail(invitation.recipientEmail)

    let user = null
    if (invitation.provisionedUserId) {
      user = await User.findById(invitation.provisionedUserId)
    }
    if (!user) {
      user = await User.findOne({ email: normalizedRecipientEmail })
    }
    if (!user) {
      user = await provisionUserFromInvitation({
        invitation,
        normalizedEmail: normalizedRecipientEmail,
        req,
      })
    }

    if (!user) {
      logger.warn(
        { email: invitation.recipientEmail, invitationId: invitation._id, requestId: req.requestId },
        'fake auth - expected pre-provisioned user not found',
      )
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: `No user account found for ${invitation.recipientEmail}. Auto-provisioning may have failed. Please revoke and re-create the invitation.`,
          requestId: req.requestId,
        },
      })
    }

    const resolvedCustomerId = invitation.provisionedCustomerId || getFirstCustomerMembershipId(user)
    const membershipUpdated = ensureCustomerAdminMembership(user, resolvedCustomerId)

    let invitationLinkUpdated = false
    if (resolvedCustomerId && !invitation.provisionedCustomerId) {
      invitation.provisionedCustomerId = resolvedCustomerId
      invitationLinkUpdated = true
    }
    if (toIdString(invitation.provisionedUserId) !== toIdString(user._id)) {
      invitation.provisionedUserId = user._id
      invitationLinkUpdated = true
    }

    // Idempotency: already trusted - mirrors real webhook behavior
    if (user.identityPlus.trustStatus === 'TRUSTED') {
      if (membershipUpdated) {
        await user.save()
        await performanceCacheService.invalidateUserPermissions(user._id)
      }
      if (invitationLinkUpdated) {
        await invitation.save()
      }

      logger.info(
        { userId: user._id, email: user.email, requestId: req.requestId },
        'fake auth - user already trusted, no-op',
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

