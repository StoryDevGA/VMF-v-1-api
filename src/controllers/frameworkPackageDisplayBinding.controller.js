import { getFrameworkPackageDisplayBinding, applyFrameworkPackageDisplayBinding } from '../services/frameworkPackageDisplayBindingService.js'

const respond = (req, res, data) => res.json({ data, meta: { requestId: req.requestId, version: 'v1' } })
export const getDisplayBinding = async (req, res, next) => {
  try { respond(req, res, await getFrameworkPackageDisplayBinding({ packageId: req.params.packageId })) }
  catch (error) { next(error) }
}
export const applyDisplayBinding = async (req, res, next) => {
  try { respond(req, res, await applyFrameworkPackageDisplayBinding({ packageId: req.params.packageId,
    payload: req.body, actorUserId: req.context?.userId || req.userId, auditRequest: req })) }
  catch (error) { next(error) }
}
