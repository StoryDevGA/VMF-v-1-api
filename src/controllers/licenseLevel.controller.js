import { Customer, LicenseLevel } from '../models/index.js'
import auditService from '../services/auditService.js'
import performanceCacheService from '../services/performanceCacheService.js'

const DUPLICATE_LICENSE_LEVEL_NAME_MESSAGE = 'A licence level with this name already exists.'

const normalizeLicenseLevelName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

const isDuplicateLicenseLevelNameError = (err) =>
  err?.code === 11000 && (err?.keyPattern?.nameNormalized || err?.keyPattern?.name)

export const listLicenseLevels = async (req, res, next) => {
  try {
    const {
      q,
      isActive,
      page = 1,
      pageSize = 20,
    } = req.query

    const filter = {}

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
      ]
    }

    if (typeof isActive === 'boolean') {
      filter.isActive = isActive
    }

    const pageNum = Math.max(1, Number(page) || 1)
    const limit = Math.min(100, Math.max(1, Number(pageSize) || 20))
    const skip = (pageNum - 1) * limit

    const [items, total] = await Promise.all([
      LicenseLevel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LicenseLevel.countDocuments(filter),
    ])

    // Get customer counts per licence level in one query
    const licenseLevelIds = items.map((item) => item._id)
    const customerCounts = await Customer.aggregate([
      { $match: { licenseLevelId: { $in: licenseLevelIds } } },
      { $group: { _id: '$licenseLevelId', count: { $sum: 1 } } },
    ])
    const countMap = Object.fromEntries(
      customerCounts.map((entry) => [entry._id.toString(), entry.count]),
    )

    // Merge counts into items
    const itemsWithCounts = items.map((item) => ({
      ...item,
      customerCount: countMap[item._id.toString()] || 0,
    }))

    return res.status(200).json({
      data: itemsWithCounts,
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

export const createLicenseLevel = async (req, res, next) => {
  try {
    const normalizedName = normalizeLicenseLevelName(req.body.name)
    const existing = await LicenseLevel.findOne({ nameNormalized: normalizedName }).select('_id')

    if (existing) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_LICENSE_LEVEL_NAME_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const licenseLevel = new LicenseLevel({
      ...req.body,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await licenseLevel.save()
    await performanceCacheService.invalidateLicenseLevelEntitlements(licenseLevel._id)

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.LICENSE_LEVEL_CREATED,
      resourceType: auditService.RESOURCE_TYPES.LicenseLevel,
      resourceId: licenseLevel._id,
      scope: {},
      diff: {
        name: licenseLevel.name,
        description: licenseLevel.description,
        featureEntitlements: licenseLevel.featureEntitlements,
        isActive: licenseLevel.isActive,
      },
    })

    return res.status(201).json({
      data: licenseLevel.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateLicenseLevelNameError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_LICENSE_LEVEL_NAME_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (err?.name === 'ValidationError') {
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

export const getLicenseLevel = async (req, res, next) => {
  try {
    const licenseLevel = await LicenseLevel.findById(req.params.licenseLevelId)

    if (!licenseLevel) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Licence level not found.',
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: licenseLevel.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateLicenseLevel = async (req, res, next) => {
  try {
    const licenseLevel = await LicenseLevel.findById(req.params.licenseLevelId)

    if (!licenseLevel) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Licence level not found.',
          requestId: req.requestId,
        },
      })
    }

    if (req.body.name !== undefined) {
      const normalizedName = normalizeLicenseLevelName(req.body.name)
      const existing = await LicenseLevel.findOne({
        _id: { $ne: licenseLevel._id },
        nameNormalized: normalizedName,
      }).select('_id')

      if (existing) {
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: DUPLICATE_LICENSE_LEVEL_NAME_MESSAGE,
            requestId: req.requestId,
          },
        })
      }
    }

    const diff = {}
    const fields = ['name', 'description', 'featureEntitlements', 'isActive']
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        diff[field] = { from: licenseLevel[field], to: req.body[field] }
        licenseLevel[field] = req.body[field]
      }
    }

    const actorUserId = req.context?.userId || req.userId
    if (actorUserId) {
      licenseLevel.updatedBy = actorUserId
    }

    await licenseLevel.save()
    await performanceCacheService.invalidateLicenseLevelEntitlements(licenseLevel._id)

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.LICENSE_LEVEL_UPDATED,
      resourceType: auditService.RESOURCE_TYPES.LicenseLevel,
      resourceId: licenseLevel._id,
      scope: {},
      diff,
    })

    return res.status(200).json({
      data: licenseLevel.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateLicenseLevelNameError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_LICENSE_LEVEL_NAME_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (err?.name === 'ValidationError') {
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
