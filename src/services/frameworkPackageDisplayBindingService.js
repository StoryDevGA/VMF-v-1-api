import mongoose from 'mongoose'
import FrameworkPackage from '../models/FrameworkPackage.js'
import FrameworkPackageDisplayBinding from '../models/FrameworkPackageDisplayBinding.js'
import UIContract from '../models/UIContract.js'
import auditService from './auditService.js'
import { runUIContractDisplayCheckpoint } from './uiContractDisplayCheckpointService.js'

const fail = (reason, status = 409) => {
  throw Object.assign(new Error(`Display binding rejected: ${reason}.`), { status,
    code: status === 404 ? 'NOT_FOUND' : status === 422 ? 'VALIDATION_FAILED' : 'CONFLICT',
    details: { reason: `DISPLAY_BINDING_${reason}` } })
}
const readPackage = async (packageId, session) => {
  const identifier = String(packageId).trim()
  const query = /^[a-f\d]{24}$/i.test(identifier) ? FrameworkPackage.findById(identifier)
    : FrameworkPackage.findOne({ packageKey: identifier.toLowerCase() })
  const pkg = await (session ? query.session(session) : query).lean()
  if (!pkg) fail('PACKAGE_NOT_FOUND', 404)
  return pkg
}
const serialize = (pkg, binding) => ({ packageId: String(pkg._id), packageKey: pkg.packageKey,
  baseUiContractKey: pkg.uiContractKey, uiContractKey: binding?.uiContractKey || pkg.uiContractKey,
  hasOverride: Boolean(binding), updatedAt: binding?.updatedAt || null })

export const getFrameworkPackageDisplayBinding = async ({ packageId }) => {
  const pkg = await readPackage(packageId)
  const binding = await FrameworkPackageDisplayBinding.findOne({ packageId: pkg._id }).lean()
  return serialize(pkg, binding)
}

export const applyFrameworkPackageDisplayBinding = async ({ packageId, payload, actorUserId, auditRequest }) => {
  const keys = ['uiContractKey', 'expectedUiContractKey', 'checkpointHash']
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).length !== keys.length || !keys.every((key) => typeof payload[key] === 'string'
      && payload[key].trim() === payload[key] && payload[key].length > 0)
    || !/^[a-f0-9]{64}$/.test(payload.checkpointHash)) fail('INVALID_PAYLOAD', 422)
  const session = await mongoose.startSession()
  try {
    return await session.withTransaction(async () => {
      const checkpoint = await runUIContractDisplayCheckpoint({ packageId, uiContractKey: payload.uiContractKey, session })
      if (!checkpoint.compatible) fail('INCOMPATIBLE')
      if (checkpoint.checkpointHash !== payload.checkpointHash) fail('STALE_CHECKPOINT')
      const pkg = await readPackage(packageId, session)
      const current = await FrameworkPackageDisplayBinding.findOne({ packageId: pkg._id }).session(session).lean()
      const previous = current?.uiContractKey || pkg.uiContractKey
      if (previous !== payload.expectedUiContractKey) fail('STALE_BINDING')
      if (previous === payload.uiContractKey) fail('NO_CHANGE')
      const candidate = await UIContract.findOne({ uiContractKey: payload.uiContractKey }).session(session).lean()
      if (!candidate) fail('STALE_CANDIDATE')
      const changedAt = new Date(Math.max(Date.now(), new Date(candidate.updatedAt || 0).getTime() + 1,
        new Date(current?.updatedAt || 0).getTime() + 1))
      // A real write fences concurrent candidate edits; the transaction only promises snapshot compatibility.
      const locked = await UIContract.updateOne({ _id: candidate._id, updatedAt: candidate.updatedAt,
        status: 'ACTIVE', versionStatus: 'ACTIVE' }, {
        $set: { isLocked: true, updatedAt: changedAt,
          ...(!candidate.isLocked ? { lockedAt: changedAt, lockedBy: actorUserId } : {}) },
        $addToSet: { lockedByPackageKeys: pkg.packageKey },
      }, { session, timestamps: false, runValidators: true })
      if (locked.modifiedCount !== 1) fail('STALE_CANDIDATE')
      const next = { uiContractKey: payload.uiContractKey, updatedBy: actorUserId, updatedAt: changedAt }
      if (current) {
        const result = await FrameworkPackageDisplayBinding.updateOne({ _id: current._id,
          uiContractKey: current.uiContractKey, updatedAt: current.updatedAt }, { $set: next },
        { session, timestamps: false, runValidators: true })
        if (result.modifiedCount !== 1) fail('STALE_BINDING')
      } else {
        await FrameworkPackageDisplayBinding.create([{ packageId: pkg._id, createdBy: actorUserId,
          createdAt: changedAt, ...next }], { session })
      }
      await auditService.logFromRequest(auditRequest, { actorUserId,
        action: auditService.AUDIT_ACTIONS.PACKAGE_METADATA_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.FrameworkPackage, resourceId: pkg._id,
        scope: { frameworkKey: pkg.frameworkKey },
        diff: { uiContractDisplayBinding: { from: previous, to: payload.uiContractKey },
          checkpointHash: checkpoint.checkpointHash, existingRuntimesChanged: false },
      }, { session, throwOnError: true })
      return serialize(pkg, next)
    })
  } catch (error) {
    if (error.code === 11000) fail('STALE_BINDING')
    throw error
  } finally { await session.endSession() }
}
