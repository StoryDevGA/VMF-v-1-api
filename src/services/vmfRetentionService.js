import logger from '../config/logger.js'
import mongoose from 'mongoose'
import { Deal, User, VMF } from '../models/index.js'
import performanceCacheService from './performanceCacheService.js'

const normalizeDate = (value) => {
  if (value instanceof Date) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

export const purgeExpiredSoftDeletedVmfs = async ({ now = new Date(), limit = 200 } = {}) => {
  const cutoff = normalizeDate(now)
  const safeLimit = Math.max(1, Number(limit) || 200)

  const candidates = await VMF.find({
    deletedAt: { $ne: null },
    purgeAfter: { $lte: cutoff },
  })
    .sort({ purgeAfter: 1 })
    .limit(safeLimit)
    .select('_id customerId tenantId name deletedAt purgeAfter')

  let purgedCount = 0
  let skippedDueToActiveDeals = 0
  let failedCount = 0

  for (const vmf of candidates) {
    let session
    try {
      session = await mongoose.startSession()
      const purged = await session.withTransaction(async () => {
        // Claim the parent first. Deal writers touch the same document inside
        // their transaction, so an old validation read cannot race this purge.
        const deleted = await VMF.deleteOne({
          _id: vmf._id,
          deletedAt: { $type: 'date' },
          purgeAfter: { $type: 'date', $lte: cutoff },
        }, { session })
        if (deleted.deletedCount !== 1) return false
        const activeDeals = await Deal.countDocuments({ vmfId: vmf._id, status: 'ACTIVE' }).session(session)
        if (activeDeals > 0) {
          const error = new Error('Active deals prevent retention purge')
          error.code = 'VMF_RETENTION_ACTIVE_DEALS'
          throw error
        }
        await Deal.updateMany({ vmfId: vmf._id }, { $set: { status: 'ARCHIVED' } }, { session })
        await User.updateMany(
          { 'vmfGrants.vmfId': vmf._id },
          { $pull: { vmfGrants: { vmfId: vmf._id } } },
          { session },
        )
        return true
      })
      if (purged) purgedCount += 1
    } catch (err) {
      if (err.code === 'VMF_RETENTION_ACTIVE_DEALS') {
        skippedDueToActiveDeals += 1
        continue
      }
      failedCount += 1
      logger.warn(
        {
          err,
          vmfId: vmf._id,
          customerId: vmf.customerId,
          tenantId: vmf.tenantId,
        },
        'vmf retention purge failed for VMF',
      )
    } finally {
      if (session) await session.endSession()
    }
  }

  if (purgedCount > 0) {
    await performanceCacheService.invalidateAllUserPermissions()
  }

  return {
    scannedCount: candidates.length,
    purgedCount,
    skippedDueToActiveDeals,
    failedCount,
    cutoff,
  }
}

const vmfRetentionService = {
  purgeExpiredSoftDeletedVmfs,
}

export default vmfRetentionService
