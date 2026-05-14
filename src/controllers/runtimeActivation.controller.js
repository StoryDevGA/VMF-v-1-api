import {
  getRuntimeActivationReadiness,
} from '../services/runtimeActivation/runtimeActivationService.js'
import RuntimeActivationSnapshot from '../models/RuntimeActivationSnapshot.js'
import RuntimeDeployment from '../models/RuntimeDeployment.js'

const serializeDoc = (doc) => {
  if (!doc) return null
  const ret = typeof doc.toJSON === 'function'
    ? doc.toJSON()
    : typeof doc.toObject === 'function'
      ? doc.toObject()
      : { ...doc }
  if (ret._id) {
    ret.id = String(ret._id)
    delete ret._id
  }
  delete ret.__v
  return ret
}

export const getRuntimeActivationPackageReadiness = async (req, res, next) => {
  try {
    const readiness = await getRuntimeActivationReadiness({
      packageId: req.params.packageId,
    })

    if (!readiness) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Framework package was not found.',
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: readiness,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (error) {
    return next(error)
  }
}

export const getRuntimeActivationPackageHistory = async (req, res, next) => {
  try {
    const rows = await RuntimeActivationSnapshot.find({ packageId: req.params.packageId })
      .sort({ activatedAt: -1, createdAt: -1 })
      .limit(50)
      .lean()

    return res.status(200).json({
      data: rows.map(serializeDoc),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (error) {
    return next(error)
  }
}

export const listRuntimeDeployments = async (req, res, next) => {
  try {
    const rows = await RuntimeDeployment.find({})
      .sort({ registeredAt: -1, createdAt: -1 })
      .limit(100)
      .lean()

    return res.status(200).json({
      data: rows.map(serializeDoc),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (error) {
    return next(error)
  }
}

export const getRuntimeActivationSnapshot = async (req, res, next) => {
  try {
    const snapshot = await RuntimeActivationSnapshot.findOne({ activationId: req.params.activationId }).lean()

    if (!snapshot) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Runtime activation snapshot was not found.',
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: serializeDoc(snapshot),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (error) {
    return next(error)
  }
}
