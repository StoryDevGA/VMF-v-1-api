/**
 * GDPR Controller (Phase 5.2)
 *
 * Request handlers for the `/api/v1/gdpr` routes:
 *
 *   GET  /export/users/:userId                 — exportUserData
 *   POST /deletion-requests                    — createDeletionRequest
 *   GET  /deletion-requests                    — listDeletionRequests
 *   GET  /deletion-requests/:requestId         — getDeletionRequest
 *   POST /deletion-requests/:requestId/process — processDeletionRequest
 *   GET  /retention                            — getRetentionInfo
 *   POST /retention/cleanup                    — runRetentionCleanup
 *
 * All handlers delegate to gdprService and return the standard
 * `{ data, meta: { requestId, version } }` envelope.
 */

import gdprService from '../services/gdprService.js'
import auditService from '../services/auditService.js'
import logger from '../config/logger.js'

const handleError = (req, res, err, fallbackMessage) => {
  const status = err.status || 500
  const code = err.code || 'INTERNAL_ERROR'

  if (status >= 500) {
    logger.error({ err, requestId: req.requestId }, fallbackMessage)
  }

  return res.status(status).json({
    error: {
      code,
      message: err.message || fallbackMessage,
      details: err.details,
      requestId: req.requestId,
    },
  })
}

export const exportUserData = async (req, res) => {
  try {
    const bundle = await gdprService.exportUserData(req.validatedParams.userId)
    return res.status(200).json({
      data: bundle,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    return handleError(req, res, err, 'Failed to export user data')
  }
}

export const createDeletionRequest = async (req, res) => {
  try {
    const data = await gdprService.createDeletionRequest({
      ...req.validatedBody,
      requestedByUserId: req.context?.userId || req.userId,
    })

    return res.status(201).json({
      data,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    return handleError(req, res, err, 'Failed to create deletion request')
  }
}

export const listDeletionRequests = async (req, res) => {
  try {
    const result = await gdprService.listDeletionRequests(req.validatedQuery)
    return res.status(200).json({
      data: result.data,
      meta: { ...result.meta, requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    return handleError(req, res, err, 'Failed to list deletion requests')
  }
}

export const getDeletionRequest = async (req, res) => {
  try {
    const data = await gdprService.getDeletionRequest(req.validatedParams.requestId)
    return res.status(200).json({
      data,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    return handleError(req, res, err, 'Failed to get deletion request')
  }
}

export const processDeletionRequest = async (req, res) => {
  try {
    const result = await gdprService.processDeletionRequest({
      requestId: req.validatedParams.requestId,
      reviewerUserId: req.context?.userId || req.userId,
      decision: req.validatedBody.decision,
      reviewerNotes: req.validatedBody.reviewerNotes,
    })

    if (result.summary.action === 'COMPLETED') {
      await auditService.logFromRequest(req, {
        action: 'USER_DELETED',
        resourceType: 'User',
        resourceId: result.summary.deletedUserId,
        diff: {
          source: 'GDPR_DELETION_REQUEST',
          requestId: req.validatedParams.requestId,
          anonymizedAuditLogs: result.summary.anonymizedAuditLogs,
        },
      })
    }

    return res.status(200).json({
      data: result,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    return handleError(req, res, err, 'Failed to process deletion request')
  }
}

export const getRetentionInfo = async (req, res) => {
  try {
    const info = await gdprService.getRetentionInfo()
    return res.status(200).json({
      data: info,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    return handleError(req, res, err, 'Failed to get GDPR retention info')
  }
}

export const runRetentionCleanup = async (req, res) => {
  try {
    const result = await gdprService.runRetentionCleanup()
    return res.status(200).json({
      data: result,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    return handleError(req, res, err, 'Failed to run GDPR retention cleanup')
  }
}
