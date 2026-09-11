import FrameworkPackageDisplayBinding from '../models/FrameworkPackageDisplayBinding.js'
import UIContract from '../models/UIContract.js'

// Existing instances never consult the mutable package display selection.
export const resolveRuntimeUIContractKey = (frameworkPackage, runtimeInstance) =>
  runtimeInstance?.uiContractDisplayKey || frameworkPackage?.uiContractBinding?.key || frameworkPackage?.uiContractKey

export const selectRuntimeDisplayPin = async ({ packageId, session }) => {
  const query = FrameworkPackageDisplayBinding.findOne({ packageId })
  const binding = await (session ? query.session(session) : query).lean()
  if (!binding) return undefined
  const candidateQuery = UIContract.findOne({ uiContractKey: binding.uiContractKey,
    status: 'ACTIVE', versionStatus: 'ACTIVE', isLocked: true })
  const candidate = await (session ? candidateQuery.session(session) : candidateQuery).lean()
  if (!candidate) throw Object.assign(new Error('The selected display contract is unavailable.'), {
    status: 409, code: 'CONFLICT', details: { reason: 'DISPLAY_BINDING_CANDIDATE_UNAVAILABLE' },
  })
  return binding.uiContractKey
}
