/**
 * GDPR Service (Phase 5.2)
 *
 * Implements:
 *   - data export bundles for a user
 *   - data deletion request workflow
 *   - user-related audit-log anonymization with signature re-sealing
 *   - GDPR record retention cleanup
 */

import crypto from 'crypto'
import { AuditLog, DataDeletionRequest, Tenant, User } from '../models/index.js'
import auditRetentionService from './auditRetentionService.js'
import env from '../config/env.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                               */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000

const makeHttpError = (status, code, message, details) => {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.details = details
  return err
}

const resolveCustomerId = (userDoc) =>
  userDoc?.memberships?.find((m) => m?.customerId)?.customerId || null

const redactedEmail = (userId) => `deleted+${String(userId)}@anonymized.local`
const redactedName = (userId) => `Deleted User ${String(userId).slice(-6)}`

const redactSensitiveData = (value) => {
  if (Array.isArray(value)) return value.map(redactSensitiveData)
  if (!value || typeof value !== 'object') return value

  const result = {}
  for (const [key, val] of Object.entries(value)) {
    if (/email|name|externalid|password|token|secret/i.test(key)) {
      result[key] = '[REDACTED]'
      continue
    }
    result[key] = redactSensitiveData(val)
  }
  return result
}

const computeAuditSignature = (doc, diff) => {
  const data = {
    ts: doc.ts,
    actorUserId: doc.actorUserId,
    action: doc.action,
    resourceType: doc.resourceType,
    resourceId: doc.resourceId,
    scope: doc.scope,
    diff,
    ip: doc.ip,
    userAgent: doc.userAgent,
    requestId: doc.requestId,
  }
  return crypto
    .createHmac('sha256', env.auditSignatureSecret)
    .update(JSON.stringify(data, null, 0))
    .digest('hex')
}

/* ------------------------------------------------------------------ */
/*  Audit anonymization                                               */
/* ------------------------------------------------------------------ */

/**
 * Anonymize all audit-log entries associated with a user.
 *
 * Redacts sensitive fields in each log's `diff` and re-computes the
 * HMAC signature so integrity verification still passes.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<{matchedCount: number, updatedCount: number}>}
 */
const anonymizeUserAuditTrail = async (userId) => {
  const query = {
    $or: [
      { resourceType: 'User', resourceId: userId },
      { actorUserId: userId },
    ],
  }

  const logs = await AuditLog.find(query).lean()
  if (logs.length === 0) {
    return { matchedCount: 0, updatedCount: 0 }
  }

  const operations = []
  for (const logDoc of logs) {
    const sanitizedDiff = redactSensitiveData(logDoc.diff)
    const hasChanged =
      JSON.stringify(logDoc.diff ?? null) !== JSON.stringify(sanitizedDiff ?? null)

    if (!hasChanged) continue

    operations.push({
      updateOne: {
        filter: { _id: logDoc._id },
        update: {
          $set: {
            diff: sanitizedDiff,
            signature: computeAuditSignature(logDoc, sanitizedDiff),
          },
        },
      },
    })
  }

  if (operations.length > 0) {
    await AuditLog.collection.bulkWrite(operations, { ordered: false })
  }

  return {
    matchedCount: logs.length,
    updatedCount: operations.length,
  }
}

/* ------------------------------------------------------------------ */
/*  Data export                                                       */
/* ------------------------------------------------------------------ */

/**
 * Build a GDPR-compliant data-export bundle for a single user.
 *
 * Includes profile, audit trail (capped by `gdprExportAuditLimit`),
 * and any existing deletion requests.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<Object>} Export bundle with `user`, `auditLogs`, `deletionRequests`, `meta`
 */
const exportUserData = async (userId) => {
  const userDoc = await User.findById(userId)
  if (!userDoc) {
    throw makeHttpError(404, 'NOT_FOUND', 'User not found.')
  }
  const user = userDoc.toObject ? userDoc.toObject() : userDoc

  const auditQuery = {
    $or: [
      { resourceType: 'User', resourceId: userId },
      { actorUserId: userId },
    ],
  }

  const [auditLogs, totalAuditLogs, deletionRequests] = await Promise.all([
    AuditLog.find(auditQuery)
      .sort({ ts: -1 })
      .limit(env.gdprExportAuditLimit)
      .lean(),
    AuditLog.countDocuments(auditQuery),
    DataDeletionRequest.find({ userId }).sort({ createdAt: -1 }).lean(),
  ])

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      identityPlus: user.identityPlus,
      memberships: user.memberships,
      tenantMemberships: user.tenantMemberships,
      vmfGrants: user.vmfGrants,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    auditLogs,
    deletionRequests,
    meta: {
      auditLogCount: totalAuditLogs,
      returnedAuditLogCount: auditLogs.length,
      auditLogsTruncated: totalAuditLogs > auditLogs.length,
      deletionRequestCount: deletionRequests.length,
      exportAuditLogLimit: env.gdprExportAuditLimit,
    },
  }
}

/* ------------------------------------------------------------------ */
/*  Deletion request workflow                                         */
/* ------------------------------------------------------------------ */

/**
 * Create a new data-deletion request for a user.
 *
 * Rejects with 409 if a PENDING request already exists.
 *
 * @param {Object} params
 * @param {string} params.userId           — target user's ObjectId
 * @param {string} params.requestedByUserId — actor who filed the request
 * @param {string} [params.reason]         — free-text justification
 * @param {string} [params.legalBasis]     — one of the legal-basis enum values
 * @returns {Promise<Object>} The created request document (JSON)
 */
const createDeletionRequest = async ({ userId, requestedByUserId, reason, legalBasis }) => {
  const user = await User.findById(userId)
  if (!user) {
    throw makeHttpError(404, 'NOT_FOUND', 'User not found.')
  }

  const existingPending = await DataDeletionRequest.findOne({
    userId,
    status: 'PENDING',
  }).lean()

  if (existingPending) {
    throw makeHttpError(
      409,
      'CONFLICT',
      'A pending deletion request already exists for this user.',
    )
  }

  const created = await DataDeletionRequest.create({
    userId,
    customerId: resolveCustomerId(user),
    requestedByUserId,
    status: 'PENDING',
    reason: reason || '',
    legalBasis: legalBasis || 'USER_REQUEST',
  })

  return created.toJSON()
}

/**
 * Paginated list of deletion requests with optional status / userId filters.
 *
 * @param {Object} params
 * @param {string} [params.status]   — filter by PENDING | COMPLETED | REJECTED
 * @param {string} [params.userId]   — filter by target user
 * @param {number} [params.page=1]
 * @param {number} [params.pageSize=20]
 * @returns {Promise<{data: Object[], meta: Object}>}
 */
const listDeletionRequests = async ({ status, userId, page = 1, pageSize = 20 }) => {
  const query = {}
  if (status) query.status = status
  if (userId) query.userId = userId

  const safePage = Math.max(1, Number.parseInt(page, 10) || 1)
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20))
  const skip = (safePage - 1) * safePageSize

  const [data, total] = await Promise.all([
    DataDeletionRequest.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safePageSize)
      .lean(),
    DataDeletionRequest.countDocuments(query),
  ])

  return {
    data,
    meta: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize),
    },
  }
}

/**
 * Retrieve a single deletion request by its ObjectId.
 *
 * @param {string} requestId
 * @returns {Promise<Object>}
 */
const getDeletionRequest = async (requestId) => {
  const requestDoc = await DataDeletionRequest.findById(requestId)
  const data = requestDoc?.toObject ? requestDoc.toObject() : requestDoc
  if (!data) {
    throw makeHttpError(404, 'NOT_FOUND', 'Deletion request not found.')
  }
  return data
}

/**
 * Process (approve or reject) a pending deletion request.
 *
 * On APPROVE the target user must already be disabled.  The handler:
 *   1. Exports a snapshot of the user's data.
 *   2. Removes the user from tenant admin arrays.
 *   3. Anonymizes the user's audit trail and re-seals signatures.
 *   4. Scrubs the user document, then hard-deletes it.
 *
 * @param {Object} params
 * @param {string} params.requestId      — the deletion-request ObjectId
 * @param {string} params.reviewerUserId — actor performing the review
 * @param {'APPROVE'|'REJECT'} params.decision
 * @param {string} [params.reviewerNotes]
 * @returns {Promise<{request: Object, summary: Object}>}
 */
const processDeletionRequest = async ({
  requestId,
  reviewerUserId,
  decision,
  reviewerNotes,
}) => {
  const requestDoc = await DataDeletionRequest.findById(requestId)
  if (!requestDoc) {
    throw makeHttpError(404, 'NOT_FOUND', 'Deletion request not found.')
  }
  if (requestDoc.status !== 'PENDING') {
    throw makeHttpError(
      409,
      'CONFLICT',
      `Deletion request is already ${requestDoc.status.toLowerCase()}.`,
    )
  }

  const now = new Date()
  requestDoc.reviewedByUserId = reviewerUserId
  requestDoc.reviewedAt = now
  requestDoc.reviewerNotes = reviewerNotes || ''

  if (decision === 'REJECT') {
    requestDoc.status = 'REJECTED'
    await requestDoc.save()
    return {
      request: requestDoc.toJSON(),
      summary: { action: 'REJECTED' },
    }
  }

  const user = await User.findById(requestDoc.userId)
  if (!user) {
    throw makeHttpError(404, 'NOT_FOUND', 'Target user no longer exists.')
  }
  if (user.isActive) {
    throw makeHttpError(
      422,
      'VALIDATION_FAILED',
      'Target user must be disabled before GDPR deletion processing.',
    )
  }

  const exportBundle = await exportUserData(user._id)

  await Tenant.updateMany(
    { tenantAdminUserIds: user._id },
    { $pull: { tenantAdminUserIds: user._id } },
  )

  const anonymizedAudit = await anonymizeUserAuditTrail(user._id)

  const anonymizedProfile = {
    email: redactedEmail(user._id),
    name: redactedName(user._id),
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        email: anonymizedProfile.email,
        name: anonymizedProfile.name,
        isActive: false,
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        'identityPlus.trustStatus': 'REVOKED',
      },
      $unset: {
        passwordHash: 1,
        'identityPlus.externalId': 1,
        'identityPlus.invitedAt': 1,
        'identityPlus.trustedAt': 1,
      },
    },
  )

  await User.deleteOne({ _id: user._id })

  requestDoc.status = 'COMPLETED'
  requestDoc.processedAt = now
  requestDoc.exportSnapshot = {
    exportedAt: exportBundle.exportedAt,
    auditLogCount: exportBundle.meta.auditLogCount,
    deletionRequestCount: exportBundle.meta.deletionRequestCount,
  }
  requestDoc.executionSummary = {
    deletedUserId: user._id,
    anonymizedProfile,
    anonymizedAuditLogs: anonymizedAudit.updatedCount,
  }
  await requestDoc.save()

  return {
    request: requestDoc.toJSON(),
    summary: {
      action: 'COMPLETED',
      deletedUserId: user._id,
      anonymizedAuditLogs: anonymizedAudit.updatedCount,
    },
  }
}

/* ------------------------------------------------------------------ */
/*  Retention policy                                                  */
/* ------------------------------------------------------------------ */

/**
 * Return current retention-policy configuration and storage statistics.
 *
 * @returns {Promise<{policy: Object, storage: Object}>}
 */
const getRetentionInfo = async () => {
  const now = new Date()
  const retentionCutoff = new Date(now.getTime() - env.gdprRetentionDays * DAY_MS)

  const [totalCount, expiredCount, pendingCount] = await Promise.all([
    DataDeletionRequest.countDocuments({}),
    DataDeletionRequest.countDocuments({
      status: { $in: ['COMPLETED', 'REJECTED'] },
      $or: [
        { processedAt: { $lt: retentionCutoff } },
        { reviewedAt: { $lt: retentionCutoff } },
        { updatedAt: { $lt: retentionCutoff } },
      ],
    }),
    DataDeletionRequest.countDocuments({ status: 'PENDING' }),
  ])

  return {
    policy: {
      retentionDays: env.gdprRetentionDays,
      cleanupIntervalMs: env.gdprCleanupIntervalMs,
      automatedCleanupEnabled: env.gdprCleanupEnabled,
    },
    storage: {
      totalCount,
      pendingCount,
      expiredCount,
      retentionCutoff,
    },
  }
}

/**
 * Execute retention cleanup — deletes completed/rejected GDPR requests
 * older than `gdprRetentionDays` and delegates audit-log cleanup to
 * `auditRetentionService.runCleanup()`.
 *
 * @returns {Promise<Object>} Cleanup summary with counts and cutoff timestamp
 */
const runRetentionCleanup = async () => {
  const now = new Date()
  const retentionCutoff = new Date(now.getTime() - env.gdprRetentionDays * DAY_MS)
  const deletionQuery = {
    status: { $in: ['COMPLETED', 'REJECTED'] },
    $or: [
      { processedAt: { $lt: retentionCutoff } },
      { reviewedAt: { $lt: retentionCutoff } },
      { updatedAt: { $lt: retentionCutoff } },
    ],
  }

  const [expiredCount, deleteResult, auditCleanup] = await Promise.all([
    DataDeletionRequest.countDocuments(deletionQuery),
    DataDeletionRequest.deleteMany(deletionQuery),
    auditRetentionService.runCleanup(),
  ])

  const deletedCount = deleteResult?.deletedCount || 0

  logger.info(
    { expiredCount, deletedCount, retentionCutoff },
    'GDPR retention cleanup completed',
  )

  return {
    status: 'completed',
    retentionCutoff,
    expiredGdprRequests: expiredCount,
    deletedGdprRequests: deletedCount,
    auditCleanup,
    timestamp: now,
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

const gdprService = {
  exportUserData,
  createDeletionRequest,
  listDeletionRequests,
  getDeletionRequest,
  processDeletionRequest,
  getRetentionInfo,
  runRetentionCleanup,
}

export default gdprService
