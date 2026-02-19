import { Invitation } from '../models/index.js'
import env from '../config/env.js'
import logger from '../config/logger.js'
import auditService from '../services/auditService.js'
import emailService from '../services/emailService.js'
import invitationService from '../services/invitationService.js'

const ACTIVE_INVITATION_STATUSES = ['created', 'sent', 'send_failed', 'accessed']

const respondWithInvitation = (res, status, invitation, requestId) =>
  res.status(status).json({
    data: invitation.toJSON(),
    meta: { requestId, version: 'v1' },
  })

const markExpiredIfNeeded = async (invitation, req) => {
  if (!invitation.isExpired() || invitation.status === 'expired') return false
  const previousStatus = invitation.status
  invitation.status = 'expired'
  await invitation.save()

  await auditService.log({
    actorUserId: env.systemActorUserId || invitation.createdBy,
    action: auditService.AUDIT_ACTIONS.INVITATION_EXPIRED,
    resourceType: auditService.RESOURCE_TYPES.Invitation,
    resourceId: invitation._id,
    scope: {},
    diff: { status: { from: previousStatus, to: 'expired' } },
    ip: req.ip,
    userAgent: req.get?.('user-agent'),
    requestId: req.requestId,
  })
  return true
}

export const createInvitation = async (req, res, next) => {
  try {
    const recipientEmail = req.body.recipientEmail.toLowerCase()

    const existing = await Invitation.findOne({
      recipientEmail,
      status: { $in: ACTIVE_INVITATION_STATUSES },
    })

    if (existing) {
      const expired = await markExpiredIfNeeded(existing, req)
      if (!expired) {
        return res.status(409).json({
          error: {
            code: 'INVITATION_ALREADY_ACTIVE',
            message: 'An active invitation already exists for this email address.',
            requestId: req.requestId,
          },
        })
      }
    }

    const { raw, hash } = Invitation.generateToken()
    const invitation = await Invitation.create({
      recipientEmail,
      recipientName: req.body.recipientName,
      company: req.body.company,
      status: 'created',
      tokenHash: hash,
      expiresAt: invitationService.computeExpiryDate(),
      createdBy: req.userId,
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.INVITATION_CREATED,
      resourceType: auditService.RESOURCE_TYPES.Invitation,
      resourceId: invitation._id,
      scope: {},
      diff: {
        status: { from: null, to: 'created' },
        recipientEmail: invitation.recipientEmail,
        company: invitation.company?.name,
      },
    })

    try {
      await emailService.sendInvitationEmail({
        to: invitation.recipientEmail,
        name: invitation.recipientName,
        authLink: invitationService.buildAuthLink(raw),
        expiresAt: invitation.expiresAt,
      })
      invitation.status = 'sent'
      invitation.sentAt = new Date()
      await invitation.save()

      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.INVITATION_SENT,
        resourceType: auditService.RESOURCE_TYPES.Invitation,
        resourceId: invitation._id,
        scope: {},
        diff: { status: { from: 'created', to: 'sent' } },
      })

      return respondWithInvitation(res, 201, invitation, req.requestId)
    } catch (sendErr) {
      invitation.status = 'send_failed'
      invitation.sendFailedAt = new Date()
      invitation.sendFailureReason = sendErr.message
      await invitation.save()

      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.INVITATION_SEND_FAILED,
        resourceType: auditService.RESOURCE_TYPES.Invitation,
        resourceId: invitation._id,
        scope: {},
        diff: {
          status: { from: 'created', to: 'send_failed' },
          reason: sendErr.message,
        },
      })

      return respondWithInvitation(res, 202, invitation, req.requestId)
    }
  } catch (err) {
    next(err)
  }
}

export const listInvitations = async (req, res, next) => {
  try {
    const { status, q, page = 1, pageSize = 20 } = req.query
    const filter = {}

    if (status) filter.status = status
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter.$or = [
        { recipientEmail: { $regex: escaped, $options: 'i' } },
        { recipientName: { $regex: escaped, $options: 'i' } },
      ]
    }

    const pageNum = Math.max(1, Number(page) || 1)
    const limit = Math.min(100, Math.max(1, Number(pageSize) || 20))
    const skip = (pageNum - 1) * limit

    const [invitations, total] = await Promise.all([
      Invitation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Invitation.countDocuments(filter),
    ])

    return res.status(200).json({
      data: invitations.map((invitation) => invitation.toJSON()),
      meta: {
        page: pageNum,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

export const getInvitation = async (req, res, next) => {
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

    return respondWithInvitation(res, 200, invitation, req.requestId)
  } catch (err) {
    next(err)
  }
}

export const resendInvitation = async (req, res, next) => {
  try {
    const invitation = await Invitation.findById(req.params.invitationId).select('+tokenHash')
    if (!invitation) {
      return res.status(404).json({
        error: {
          code: 'INVITATION_NOT_FOUND',
          message: 'Invitation not found.',
          requestId: req.requestId,
        },
      })
    }

    const expired = await markExpiredIfNeeded(invitation, req)
    if (!invitation.isResendable() || expired) {
      return res.status(409).json({
        error: {
          code: 'INVITATION_NOT_RESENDABLE',
          message: 'Invitation cannot be resent in its current state.',
          requestId: req.requestId,
        },
      })
    }

    const { raw, hash } = Invitation.generateToken()
    invitation.tokenHash = hash
    invitation.status = 'sent'
    invitation.resendCount += 1
    invitation.lastResentAt = new Date()
    invitation.expiresAt = invitationService.computeExpiryDate()
    invitation.accessedAt = undefined
    invitation.sendFailureReason = undefined
    invitation.sendFailedAt = undefined

    try {
      await emailService.sendInvitationEmail({
        to: invitation.recipientEmail,
        name: invitation.recipientName,
        authLink: invitationService.buildAuthLink(raw),
        expiresAt: invitation.expiresAt,
      })

      await invitation.save()

      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.INVITATION_RESENT,
        resourceType: auditService.RESOURCE_TYPES.Invitation,
        resourceId: invitation._id,
        scope: {},
        diff: {
          resendCount: invitation.resendCount,
        },
      })

      return respondWithInvitation(res, 200, invitation, req.requestId)
    } catch (sendErr) {
      invitation.status = 'send_failed'
      invitation.sendFailedAt = new Date()
      invitation.sendFailureReason = sendErr.message
      await invitation.save()

      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.INVITATION_SEND_FAILED,
        resourceType: auditService.RESOURCE_TYPES.Invitation,
        resourceId: invitation._id,
        scope: {},
        diff: {
          status: { from: 'sent', to: 'send_failed' },
          reason: sendErr.message,
        },
      })

      return respondWithInvitation(res, 202, invitation, req.requestId)
    }
  } catch (err) {
    next(err)
  }
}

export const revokeInvitation = async (req, res, next) => {
  try {
    const invitation = await Invitation.findById(req.params.invitationId).select('+tokenHash')
    if (!invitation) {
      return res.status(404).json({
        error: {
          code: 'INVITATION_NOT_FOUND',
          message: 'Invitation not found.',
          requestId: req.requestId,
        },
      })
    }

    if (['revoked', 'authenticated', 'expired'].includes(invitation.status)) {
      return res.status(409).json({
        error: {
          code: 'INVITATION_ALREADY_TERMINAL',
          message: 'Invitation cannot be revoked in its current state.',
          requestId: req.requestId,
        },
      })
    }

    const previousStatus = invitation.status
    invitation.status = 'revoked'
    invitation.revokedAt = new Date()
    invitation.revokedBy = req.userId
    invitation.tokenHash = undefined
    await invitation.save()

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.INVITATION_REVOKED,
      resourceType: auditService.RESOURCE_TYPES.Invitation,
      resourceId: invitation._id,
      scope: {},
      diff: {
        status: { from: previousStatus, to: 'revoked' },
        reason: req.body.reason,
      },
    })

    return respondWithInvitation(res, 200, invitation, req.requestId)
  } catch (err) {
    next(err)
  }
}

export const handleAuthLinkAccess = async (req, res, next) => {
  try {
    const invitation = await Invitation.findByToken(req.params.token)
    if (!invitation) {
      return res.redirect(302, invitationService.buildInvitationErrorUrl('not_found'))
    }

    if (invitation.isExpired()) {
      if (invitation.status !== 'expired') {
        const previousStatus = invitation.status
        invitation.status = 'expired'
        await invitation.save()
        await auditService.log({
          actorUserId: env.systemActorUserId || invitation.createdBy,
          action: auditService.AUDIT_ACTIONS.INVITATION_EXPIRED,
          resourceType: auditService.RESOURCE_TYPES.Invitation,
          resourceId: invitation._id,
          scope: {},
          diff: { status: { from: previousStatus, to: 'expired' } },
          ip: req.ip,
          userAgent: req.get?.('user-agent'),
          requestId: req.requestId,
        })
      }
      return res.redirect(302, invitationService.buildInvitationErrorUrl('expired'))
    }

    if (invitation.status === 'revoked') {
      return res.redirect(302, invitationService.buildInvitationErrorUrl('revoked'))
    }

    if (invitation.status === 'authenticated') {
      return res.redirect(302, invitationService.buildInvitationErrorUrl('already_authenticated'))
    }

    if (invitation.status === 'accessed') {
      return res.redirect(302, invitationService.buildInvitationErrorUrl('already_used'))
    }

    if (!['sent', 'send_failed'].includes(invitation.status)) {
      return res.redirect(302, invitationService.buildInvitationErrorUrl('invalid_state'))
    }

    const previousStatus = invitation.status
    invitation.status = 'accessed'
    invitation.accessedAt = new Date()
    await invitation.save()

    await auditService.log({
      actorUserId: env.systemActorUserId || invitation.createdBy,
      action: auditService.AUDIT_ACTIONS.INVITATION_AUTH_LINK_ACCESSED,
      resourceType: auditService.RESOURCE_TYPES.Invitation,
      resourceId: invitation._id,
      scope: {},
      diff: {
        status: { from: previousStatus, to: 'accessed' },
      },
      ip: req.ip,
      userAgent: req.get?.('user-agent'),
      requestId: req.requestId,
    })

    return res.redirect(302, invitationService.buildIdentityPlusRedirectUrl(invitation._id))
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'invitation auth link processing failed')
    return res.redirect(302, invitationService.buildInvitationErrorUrl('server_error'))
  }
}
