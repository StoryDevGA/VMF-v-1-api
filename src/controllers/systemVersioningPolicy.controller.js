import mongoose from 'mongoose'
import { SystemVersioningPolicy } from '../models/index.js'
import auditService from '../services/auditService.js'

export const getActivePolicy = async (req, res, next) => {
  try {
    const policy = await SystemVersioningPolicy.findActive()
    if (!policy) {
      return res.status(404).json({
        error: {
          code: 'NO_ACTIVE_POLICY',
          message: 'No active versioning policy found.',
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: policy.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const listPolicyHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const skip = (page - 1) * pageSize

    const [items, total] = await Promise.all([
      SystemVersioningPolicy.find({}).sort({ version: -1 }).skip(skip).limit(pageSize),
      SystemVersioningPolicy.countDocuments({}),
    ])

    return res.status(200).json({
      data: items.map((item) => item.toJSON()),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

export const createPolicy = async (req, res, next) => {
  const session = await mongoose.startSession()
  try {
    const { name, description, rules, reason } = req.body

    let newPolicy
    let previousPolicyId = null

    await session.withTransaction(async () => {
      const previousPolicy = await SystemVersioningPolicy.findOne({ isActive: true })
        .sort({ version: -1 })
        .session(session)

      if (previousPolicy) {
        previousPolicyId = previousPolicy._id
        previousPolicy.isActive = false
        previousPolicy.supersededBy = null // placeholder, updated below
        await previousPolicy.save({ session })
      }

      newPolicy = new SystemVersioningPolicy({
        name,
        description,
        rules,
        isActive: true,
        activatedAt: new Date(),
        activatedBy: req.userId,
        createdBy: req.userId,
      })
      await newPolicy.save({ session })

      if (previousPolicy) {
        previousPolicy.supersededBy = newPolicy._id
        await previousPolicy.save({ session })
      }
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.SYSTEM_VERSIONING_POLICY_UPDATED,
      resourceType: auditService.RESOURCE_TYPES.SystemVersioningPolicy,
      resourceId: newPolicy._id,
      scope: {},
      diff: {
        previousPolicyId,
        newPolicyId: newPolicy._id,
        reason,
      },
    })

    return res.status(201).json({
      data: newPolicy.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  } finally {
    await session.endSession()
  }
}

export const patchPolicy = async (req, res, next) => {
  try {
    if (req.body.rules !== undefined) {
      return res.status(422).json({
        error: {
          code: 'RULES_UPDATE_NOT_ALLOWED',
          message: 'Rules cannot be updated in place. Create a new policy version instead.',
          requestId: req.requestId,
        },
      })
    }

    const policy = await SystemVersioningPolicy.findById(req.params.policyId)
    if (!policy) {
      return res.status(404).json({
        error: {
          code: 'POLICY_NOT_FOUND',
          message: 'System versioning policy not found.',
          requestId: req.requestId,
        },
      })
    }

    const diff = {}
    if (req.body.name !== undefined) {
      diff.name = { from: policy.name, to: req.body.name }
      policy.name = req.body.name
    }
    if (req.body.description !== undefined) {
      diff.description = { from: policy.description, to: req.body.description }
      policy.description = req.body.description
    }

    await policy.save()

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.SYSTEM_VERSIONING_POLICY_UPDATED,
      resourceType: auditService.RESOURCE_TYPES.SystemVersioningPolicy,
      resourceId: policy._id,
      scope: {},
      diff: {
        ...diff,
        reason: req.body.reason,
      },
    })

    return res.status(200).json({
      data: policy.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
