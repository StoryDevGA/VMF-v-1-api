/**
 * Deal Controller
 *
 * Handles Deal management endpoints:
 *
 *   VMF-scoped (requireVmfAccess):
 *     GET   /api/v1/vmfs/:vmfId/deals       List deals
 *     POST  /api/v1/vmfs/:vmfId/deals       Create deal
 *
 *   Deal-scoped (SUPER_ADMIN):
 *     GET    /api/v1/deals/:dealId           Get single deal
 *     PATCH  /api/v1/deals/:dealId           Update deal
 *     DELETE /api/v1/deals/:dealId           Soft-delete (archive) deal
 */

import { VMF, Deal, AuditLog } from '../models/index.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  Audit helper                                                      */
/* ------------------------------------------------------------------ */

const audit = async (actorUserId, action, resourceType, resourceId, scope, diff, req) => {
  try {
    await AuditLog.createLog({
      actorUserId,
      action,
      resourceType,
      resourceId,
      scope,
      diff,
      ip: req?.ip,
      userAgent: req?.get?.('user-agent'),
      requestId: req?.requestId,
    })
  } catch (err) {
    logger.error({ err, action, resourceType, resourceId }, 'deal audit log failed')
  }
}

/* ------------------------------------------------------------------ */
/*  GET /api/v1/vmfs/:vmfId/deals                                     */
/* ------------------------------------------------------------------ */

/**
 * List deals for a VMF.
 *
 * Query params: status, q (title/stage search), page, pageSize
 */
export const listDeals = async (req, res, next) => {
  try {
    const { vmfId } = req.params
    const {
      status,
      q,
      page = 1,
      pageSize = 20,
    } = req.query

    const filter = { vmfId }
    if (status) filter.status = status
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { stage: { $regex: q, $options: 'i' } },
      ]
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20))
    const skip = (pageNum - 1) * limit

    const [deals, total] = await Promise.all([
      Deal.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Deal.countDocuments(filter),
    ])

    return res.status(200).json({
      data: deals,
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

/* ------------------------------------------------------------------ */
/*  POST /api/v1/vmfs/:vmfId/deals                                    */
/* ------------------------------------------------------------------ */

/**
 * Create a deal under a VMF.
 */
export const createDeal = async (req, res, next) => {
  try {
    const { vmfId } = req.params
    const actorUserId = req.context?.userId || req.userId

    // Verify VMF exists and is active
    const vmf = req.scopes?.vmf || await VMF.findById(vmfId)
    if (!vmf) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'VMF not found.',
          requestId: req.requestId,
        },
      })
    }

    if (vmf.status !== 'ACTIVE') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Cannot create deals in an inactive VMF.',
          requestId: req.requestId,
        },
      })
    }

    const deal = new Deal({
      customerId: vmf.customerId,
      tenantId: vmf.tenantId,
      vmfId: vmf._id,
      title: req.body.title,
      stage: req.body.stage || undefined,
      data: req.body.data || {},
      status: 'ACTIVE',
      createdBy: actorUserId,
    })

    await deal.save()

    await audit(
      actorUserId,
      'DEAL_CREATED',
      'Deal',
      deal._id,
      { customerId: vmf.customerId, tenantId: vmf.tenantId, vmfId: vmf._id },
      { title: req.body.title },
      req,
    )

    logger.info(
      { vmfId: vmf._id, dealId: deal._id },
      'deal.controller — Deal created',
    )

    return res.status(201).json({
      data: deal.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    // Mongoose pre-save hook errors
    if (err.message?.includes('Cannot create deals')) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  GET /api/v1/deals/:dealId                                         */
/* ------------------------------------------------------------------ */

/**
 * Get a single deal.
 */
export const getDeal = async (req, res, next) => {
  try {
    const deal = await Deal.findById(req.params.dealId)

    if (!deal) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Deal not found.',
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: deal.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/v1/deals/:dealId                                       */
/* ------------------------------------------------------------------ */

/**
 * Update a deal (title, stage, data, status).
 */
export const updateDeal = async (req, res, next) => {
  try {
    const deal = await Deal.findById(req.params.dealId)

    if (!deal) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Deal not found.',
          requestId: req.requestId,
        },
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const diff = {}

    if (req.body.title !== undefined) {
      diff.title = { from: deal.title, to: req.body.title }
      deal.title = req.body.title
    }

    if (req.body.stage !== undefined) {
      diff.stage = { from: deal.stage, to: req.body.stage }
      deal.stage = req.body.stage
    }

    if (req.body.data !== undefined) {
      diff.data = { from: deal.data, to: req.body.data }
      deal.data = req.body.data
    }

    if (req.body.status !== undefined) {
      diff.status = { from: deal.status, to: req.body.status }
      deal.status = req.body.status
    }

    await deal.save()

    await audit(
      actorUserId,
      'DEAL_UPDATED',
      'Deal',
      deal._id,
      { customerId: deal.customerId, tenantId: deal.tenantId, vmfId: deal.vmfId },
      diff,
      req,
    )

    return res.status(200).json({
      data: deal.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/v1/deals/:dealId                                      */
/* ------------------------------------------------------------------ */

/**
 * Soft-delete (archive) a deal.  Per spec: soft-delete recommended.
 */
export const archiveDeal = async (req, res, next) => {
  try {
    const deal = await Deal.findById(req.params.dealId)

    if (!deal) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Deal not found.',
          requestId: req.requestId,
        },
      })
    }

    if (deal.status === 'ARCHIVED') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Deal is already archived.',
          requestId: req.requestId,
        },
      })
    }

    const actorUserId = req.context?.userId || req.userId
    deal.status = 'ARCHIVED'
    await deal.save()

    await audit(
      actorUserId,
      'DEAL_ARCHIVED',
      'Deal',
      deal._id,
      { customerId: deal.customerId, tenantId: deal.tenantId, vmfId: deal.vmfId },
      { status: { from: 'ACTIVE', to: 'ARCHIVED' } },
      req,
    )

    logger.info(
      { dealId: deal._id, vmfId: deal.vmfId },
      'deal.controller — Deal archived',
    )

    return res.status(200).json({
      data: { message: `Deal '${deal.title}' has been archived.` },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
