import logger from '../config/logger.js'
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
    try {
      const activeDeals = await Deal.countDocuments({ vmfId: vmf._id, status: 'ACTIVE' })
      if (activeDeals > 0) {
        skippedDueToActiveDeals += 1
        continue
      }

      await Deal.updateMany({ vmfId: vmf._id }, { $set: { status: 'ARCHIVED' } })
      await User.updateMany(
        { 'vmfGrants.vmfId': vmf._id },
        { $pull: { vmfGrants: { vmfId: vmf._id } } },
      )
      await VMF.deleteOne({ _id: vmf._id })
      purgedCount += 1
    } catch (err) {
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
