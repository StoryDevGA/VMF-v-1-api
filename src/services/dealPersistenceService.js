import mongoose from 'mongoose'

// Parent and child writes must commit together: a read-only parent check cannot
// prevent an in-flight deal from being inserted after retention deletes its VMF.
export const saveDealWithVmfGuard = async (deal) => mongoose.connection.transaction(async (session) => {
  const VMF = mongoose.model('VMF')
  const parent = await VMF.updateOne({
    _id: deal.vmfId,
    customerId: deal.customerId,
    tenantId: deal.tenantId,
    status: 'ACTIVE',
    deletedAt: null,
  }, { $inc: { __v: 1 } }, { session, timestamps: false })
  if (parent.matchedCount !== 1) {
    const error = new Error('Cannot create deals in inactive or deleted VMF')
    error.status = 422
    error.code = 'VALIDATION_FAILED'
    throw error
  }
  return deal.save({ session })
})
