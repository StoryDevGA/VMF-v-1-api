import { inspectSyntheticTestDisposition, recordSyntheticTestDisposition } from '../services/syntheticTestDispositionService.js'
import { buildRuntimeStateRequestScopes } from './runtimeInstance.controller.js'
import { SYNTHETIC_REVISION_TEST_POLICY as r3 } from '../constants/syntheticRevisionTestPolicy.js'

const handle = operation => async (req, res, next) => {
  try {
    const data = await operation({ actorUserId: req.context?.userId || req.userId,
      runtimeInstanceId: req.params.runtimeInstanceId,
      scopes: buildRuntimeStateRequestScopes({ scopes: req.scopes, query: req.query }),
      payload: req.body, auditRequest: req })
    return res.status(200).json({ data, meta: { requestId: req.requestId, version: 'v1' } })
  } catch (error) {
    if (error.status && error.code) return res.status(error.status).json({ error: {
      code: error.code, message: error.message, requestId: req.requestId,
    } })
    return next(error)
  }
}
const current = name => async args => (await import('../services/syntheticRevisionTestService.js'))[name](args)
const dispatch = (old, name) => args => [r3.runtimeInstanceId, r3.runtimeInstanceKey].includes(args.runtimeInstanceId)
  ? current(name)(args) : old(args)
export const readSyntheticTestDisposition = handle(dispatch(inspectSyntheticTestDisposition, 'inspectSyntheticRevisionDisposition'))
export const saveSyntheticTestDisposition = handle(dispatch(recordSyntheticTestDisposition, 'recordSyntheticRevisionDisposition'))
export const readSyntheticTestCompletion = handle(current('inspectSyntheticRevisionCompletion'))
export const saveSyntheticTestCompletion = handle(current('recordSyntheticRevisionCompletion'))
